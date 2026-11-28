package main

import (
	"context"
	"crypto/x509"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"net/url"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync"
)

type bridge struct {
	host, prefix, html string
	roots              *x509.CertPool
	mu                 sync.Mutex
	current, pending   *recorder
	quit               chan struct{}
}

func newBridge(host, prefix, html string, roots *x509.CertPool) *bridge {
	return &bridge{host: host, prefix: prefix, html: html, roots: roots, quit: make(chan struct{}, 1)}
}
func (a *bridge) disconnect() {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.current != nil {
		a.current.close()
		a.current = nil
	}
	if a.pending != nil {
		a.pending.close()
		a.pending = nil
	}
}
func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}
func bodyJSON(w http.ResponseWriter, r *http.Request, max int64, out any) error {
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, max))
	dec.DisallowUnknownFields()
	if dec.Decode(out) != nil || dec.Decode(&struct{}{}) != io.EOF {
		return bad("Invalid request body.")
	}
	return nil
}
func (a *bridge) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	h := w.Header()
	h.Set("Cache-Control", "no-store")
	h.Set("Referrer-Policy", "no-referrer")
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("X-Frame-Options", "DENY")
	h.Set("Cross-Origin-Resource-Policy", "same-origin")
	h.Set("Content-Security-Policy", "frame-ancestors 'none'; object-src 'none'")
	if r.Host != a.host || !strings.HasPrefix(r.URL.Path, a.prefix) || r.URL.RawPath != "" {
		http.NotFound(w, r)
		return
	}
	p := strings.TrimPrefix(r.URL.Path, a.prefix)
	if origin := r.Header.Get("Origin"); (origin != "" && origin != "http://"+a.host) || r.Header.Get("Sec-Fetch-Site") == "cross-site" {
		http.Error(w, "Forbidden", 403)
		return
	}
	if p == "" && r.Method == "GET" {
		h.Set("Content-Type", "text/html; charset=utf-8")
		io.WriteString(w, a.html)
		return
	}
	if r.Method == "POST" {
		mt, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type"))
		if r.Header.Get("Origin") != "http://"+a.host || mt != "application/json" {
			http.Error(w, "Same-origin JSON required", 403)
			return
		}
	}
	if err := a.route(w, r, p); err != nil {
		var e *problem
		if !errors.As(err, &e) {
			e = &problem{502, "Recorder request unsuccessful."}
		}
		writeJSON(w, e.status, map[string]string{"error": e.text})
	}
}
func (a *bridge) route(w http.ResponseWriter, r *http.Request, p string) error {
	switch {
	case p == "api/quit" && r.Method == "POST":
		a.disconnect()
		writeJSON(w, 200, state{})
		select {
		case a.quit <- struct{}{}:
		default:
		}
		return nil
	case p == "api/connect" && r.Method == "POST":
		return a.connect(w, r)
	case p == "api/disconnect" && r.Method == "POST":
		a.disconnect()
		writeJSON(w, 200, state{})
		return nil
	}
	a.mu.Lock()
	rec := a.current
	a.mu.Unlock()
	if rec == nil {
		if p == "api/state" && r.Method == "GET" {
			writeJSON(w, 200, state{})
			return nil
		}
		return &problem{401, "Connect your Frigate recorder first."}
	}
	ctx, cancel := context.WithCancel(r.Context())
	off := context.AfterFunc(rec.ctx, cancel)
	defer cancel()
	defer off()
	var err error
	switch {
	case p == "api/state" && r.Method == "GET":
		var s state
		s, err = rec.refresh(ctx)
		if err == nil {
			writeJSON(w, 200, s)
		}
	case p == "api/live" && r.Method == "POST":
		err = rec.offer(ctx, w, r)
	case strings.HasPrefix(p, "api/media/") && r.Method == "GET":
		err = rec.media(ctx, w, r, strings.TrimPrefix(p, "api/media/"))
	default:
		return &problem{404, "Unknown recorder operation."}
	}
	var prob *problem
	if errors.As(err, &prob) && prob.status == 401 {
		a.mu.Lock()
		if a.current == rec {
			rec.close()
			a.current = nil
		}
		a.mu.Unlock()
	}
	return err
}
func (a *bridge) connect(w http.ResponseWriter, r *http.Request) error {
	var in struct{ Address, User, Password string }
	if err := bodyJSON(w, r, 8<<10, &in); err != nil {
		return err
	}
	base, err := recorderURL(in.Address)
	if err != nil {
		return err
	}
	if strings.TrimSpace(in.User) == "" || in.Password == "" {
		return bad("Enter your Frigate username and password.")
	}
	rec := newRecorder(base, a.roots)
	a.mu.Lock()
	if a.pending != nil || a.current != nil {
		a.mu.Unlock()
		rec.close()
		return &problem{409, "A recorder session is already open. Disconnect it first."}
	}
	a.pending = rec
	a.mu.Unlock()
	defer func() {
		a.mu.Lock()
		defer a.mu.Unlock()
		if a.pending == rec {
			a.pending = nil
			rec.close()
		}
	}()
	ctx, cancel := context.WithCancel(r.Context())
	off := context.AfterFunc(rec.ctx, cancel)
	defer off()
	defer cancel()
	if err = rec.login(ctx, in.User, in.Password); err != nil {
		return err
	}
	in.Password = ""
	rec.loadStreams(ctx)
	s, err := rec.refresh(ctx)
	if err != nil {
		return err
	}
	a.mu.Lock()
	if a.pending != rec || ctx.Err() != nil {
		a.mu.Unlock()
		return bad("Connection cancelled.")
	}
	a.current = rec
	a.pending = nil
	a.mu.Unlock()
	writeJSON(w, 200, s)
	return nil
}
func (r *recorder) offer(ctx context.Context, w http.ResponseWriter, req *http.Request) error {
	var in struct{ Camera, Stream, SDP string }
	if err := bodyJSON(w, req, 128<<10, &in); err != nil {
		return err
	}
	r.mu.RLock()
	cam, ok := r.cams[in.Camera]
	r.mu.RUnlock()
	if !ok || !slices.Contains(cam.Streams, in.Stream) {
		return &problem{404, "Unknown camera or live stream."}
	}
	lines := strings.Split(strings.ReplaceAll(in.SDP, "\r\n", "\n"), "\n")
	video, receive := 0, false
	for _, line := range lines {
		if strings.HasPrefix(line, "m=") {
			if !strings.HasPrefix(line, "m=video ") {
				return bad("Only receive-only video is supported.")
			}
			video++
		}
		switch line {
		case "a=recvonly":
			receive = true
		case "a=sendrecv", "a=sendonly":
			return bad("Only receive-only video is supported.")
		}
	}
	if lines[0] != "v=0" || video != 1 || !receive {
		return bad("A receive-only video offer is required.")
	}
	body, _ := json.Marshal(map[string]string{"type": "offer", "sdp": in.SDP})
	var answer struct {
		Type string `json:"type"`
		SDP  string `json:"sdp"`
	}
	if err := r.json(ctx, "POST", "go2rtc/webrtc", url.Values{"src": {in.Stream}}, body, &answer); err != nil {
		return err
	}
	if answer.Type != "answer" || !strings.HasPrefix(answer.SDP, "v=0") {
		return &problem{502, "Frigate could not negotiate this live stream."}
	}
	writeJSON(w, 200, answer)
	return nil
}

var singleRange = regexp.MustCompile(`^bytes=([0-9]{1,19}-[0-9]{0,19}|-[0-9]{1,19})$`)

func (r *recorder) media(ctx context.Context, w http.ResponseWriter, req *http.Request, key string) error {
	kind, id, ok := strings.Cut(key, "/")
	if !ok || !identifier.MatchString(id) {
		return bad("Invalid media selection.")
	}
	r.mu.RLock()
	_, cam := r.cams[id]
	ev := r.events[id]
	r.mu.RUnlock()
	path, mtype := "", "image/jpeg"
	q := url.Values{}
	switch {
	case kind == "camera" && cam:
		path = id + "/latest.jpg"
		q.Set("height", "480")
	case kind == "snapshot" && ev.Snapshot:
		path = "events/" + id + "/snapshot.jpg"
	case kind == "clip" && ev.Clip:
		path = "events/" + id + "/clip.mp4"
		mtype = "video/mp4"
	default:
		return &problem{404, "This item is not in the current camera or event list."}
	}
	br := req.Header.Get("Range")
	if br != "" && (kind != "clip" || !singleRange.MatchString(br)) {
		return &problem{416, "Unsupported media range."}
	}
	resp, err := r.request(ctx, "GET", path, q, nil, br)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	upType, _, _ := mime.ParseMediaType(resp.Header.Get("Content-Type"))
	if upType != mtype {
		return &problem{502, "The recorder did not return the requested media format."}
	}
	if kind != "clip" {
		b, err := io.ReadAll(io.LimitReader(resp.Body, (12<<20)+1))
		if err != nil || len(b) > 12<<20 {
			return &problem{502, "Snapshot unavailable or too large."}
		}
		w.Header().Set("Content-Type", mtype)
		w.Write(b)
		return nil
	}
	w.Header().Set("Content-Type", mtype)
	for _, name := range []string{"Content-Range", "Accept-Ranges"} {
		if v := resp.Header.Get(name); v != "" {
			w.Header().Set(name, v)
		}
	}
	if resp.ContentLength >= 0 {
		w.Header().Set("Content-Length", strconv.FormatInt(resp.ContentLength, 10))
	}
	w.WriteHeader(resp.StatusCode)
	io.Copy(w, resp.Body)
	return nil
}

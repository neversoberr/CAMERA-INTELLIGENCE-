package main

import (
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

type problem struct {
	status int
	text   string
}

func (e *problem) Error() string { return e.text }
func bad(s string) error         { return &problem{400, s} }
func upstreamError(code int) error {
	switch code {
	case 401:
		return &problem{401, "Frigate sign-in failed or expired. Check your viewer account and sign in again."}
	case 403:
		return &problem{403, "Frigate denied access. Check this account’s camera permissions."}
	case 404, 410:
		return &problem{404, "Not available on this recorder. The item may have expired or the feature may not be configured."}
	case 429:
		return &problem{429, "Frigate is limiting requests. Wait before trying again."}
	case 416:
		return &problem{416, "Clip range unavailable."}
	default:
		return &problem{502, "The recorder returned an unexpected response. Check the Frigate dashboard address."}
	}
}

var identifier = regexp.MustCompile(`^[a-zA-Z0-9_-][a-zA-Z0-9_.-]{0,127}$`)
var prefixPath = regexp.MustCompile(`^(/[A-Za-z0-9_-]+)*/?$`)

func recorderURL(raw string) (*url.URL, error) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Scheme != "https" || u.Hostname() == "" || u.User != nil || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" || u.RawPath != "" || !prefixPath.MatchString(u.Path) {
		return nil, bad("Enter the HTTPS address of your Frigate dashboard, without credentials, query or fragment.")
	}
	if strings.EqualFold(u.Hostname(), "github.com") {
		return nil, bad("Use your running recorder’s address, not the GitHub project URL.")
	}
	u.Path = strings.TrimRight(u.Path, "/")
	return u, nil
}

type camera struct {
	ID           string   `json:"id"`
	FPS          *float64 `json:"fps"`
	DetectionFPS *float64 `json:"detectionFps"`
	Streams      []string `json:"streams"`
}
type event struct {
	ID       string   `json:"id"`
	Camera   string   `json:"camera"`
	Label    string   `json:"label"`
	Start    float64  `json:"start_time"`
	End      *float64 `json:"end_time"`
	Snapshot bool     `json:"has_snapshot"`
	Clip     bool     `json:"has_clip"`
	Zones    []string `json:"zones"`
}
type state struct {
	Connected bool     `json:"connected"`
	Address   string   `json:"address,omitempty"`
	Version   string   `json:"version,omitempty"`
	Cameras   []camera `json:"cameras"`
	Events    []event  `json:"events"`
	Updated   int64    `json:"updated"`
}
type recorder struct {
	base      *url.URL
	client    *http.Client
	ctx       context.Context
	cancel    context.CancelFunc
	refreshMu sync.Mutex
	mu        sync.RWMutex
	cams      map[string]camera
	events    map[string]event
	streams   map[string][]string
}

func newRecorder(base *url.URL, roots *x509.CertPool) *recorder {
	jar, _ := cookiejar.New(nil)
	ctx, cancel := context.WithCancel(context.Background())
	return &recorder{base: base, ctx: ctx, cancel: cancel, client: &http.Client{Jar: jar, Timeout: 120 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }, Transport: &http.Transport{TLSClientConfig: &tls.Config{RootCAs: roots, MinVersion: tls.VersionTLS12}, TLSHandshakeTimeout: 6 * time.Second, ResponseHeaderTimeout: 10 * time.Second, IdleConnTimeout: 30 * time.Second, MaxConnsPerHost: 8}}}
}
func (r *recorder) close() { r.cancel(); r.client.CloseIdleConnections() }

// Neither arbitrary upstream paths nor browser-supplied headers pass through.
func (r *recorder) request(ctx context.Context, method, path string, q url.Values, body []byte, byteRange string) (*http.Response, error) {
	u := *r.base
	u.Path += "/api/" + path
	u.RawQuery = q.Encode()
	req, err := http.NewRequestWithContext(ctx, method, u.String(), bytes.NewReader(body))
	if err != nil {
		return nil, bad("Invalid request")
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if byteRange != "" {
		req.Header.Set("Range", byteRange)
	}
	resp, err := r.client.Do(req)
	if err != nil {
		var cert *tls.CertificateVerificationError
		if errors.As(err, &cert) {
			return nil, &problem{502, "TLS certificate not trusted for this hostname. Use the correct HTTPS name and your site’s trusted CA."}
		}
		return nil, &problem{502, "Cannot reach Frigate. Check the address, your site network, and the recorder."}
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		resp.Body.Close()
		return nil, upstreamError(resp.StatusCode)
	}
	return resp, nil
}
func (r *recorder) json(ctx context.Context, method, path string, q url.Values, body []byte, out any) error {
	ctx, cancel := context.WithTimeout(ctx, 12*time.Second)
	defer cancel()
	resp, err := r.request(ctx, method, path, q, body, "")
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if out == nil {
		return nil
	}
	b, err := io.ReadAll(io.LimitReader(resp.Body, (4<<20)+1))
	if err != nil || len(b) > 4<<20 || json.Unmarshal(b, out) != nil {
		return &problem{502, "Expected a Frigate API response. Check the HTTPS dashboard address and Frigate version."}
	}
	return nil
}
func (r *recorder) login(ctx context.Context, user, password string) error {
	body, _ := json.Marshal(map[string]string{"user": user, "password": password})
	if err := r.json(ctx, "POST", "login", nil, body, nil); err != nil {
		return err
	}
	endpoint := *r.base
	endpoint.Path += "/api/stats"
	if len(r.client.Jar.Cookies(&endpoint)) == 0 {
		return &problem{401, "Frigate did not issue a login session. Use its authenticated dashboard and a Frigate viewer account."}
	}
	return nil
}

// Optional, viewer-scoped config for named live streams. Only keep stream names;
// never pass config, camera URLs, commands or credentials to the renderer.
func (r *recorder) loadStreams(ctx context.Context) {
	var cfg struct {
		Cameras map[string]struct {
			Live struct {
				Streams map[string]string `json:"streams"`
			} `json:"live"`
		} `json:"cameras"`
	}
	if r.json(ctx, "GET", "config", nil, nil, &cfg) != nil {
		return
	}
	r.streams = map[string][]string{}
	for id, c := range cfg.Cameras {
		seen := map[string]bool{}
		for _, s := range c.Live.Streams {
			if identifier.MatchString(s) && !seen[s] {
				r.streams[id] = append(r.streams[id], s)
				seen[s] = true
			}
		}
		sort.Strings(r.streams[id])
	}
}
func (r *recorder) refresh(ctx context.Context) (state, error) {
	r.refreshMu.Lock()
	defer r.refreshMu.Unlock()
	var stats struct {
		Service struct {
			Version string `json:"version"`
		} `json:"service"`
		Cameras map[string]struct {
			FPS    *float64 `json:"camera_fps"`
			Detect *float64 `json:"detection_fps"`
		} `json:"cameras"`
	}
	s := state{Connected: true, Address: r.base.Host, Cameras: []camera{}, Events: []event{}}
	if err := r.json(ctx, "GET", "stats", nil, nil, &stats); err != nil {
		return state{}, err
	}
	if stats.Cameras == nil {
		return state{}, &problem{502, "Frigate camera stats are not ready. Check the recorder and retry."}
	}
	s.Version = stats.Service.Version
	cams := map[string]camera{}
	for id, raw := range stats.Cameras {
		if !identifier.MatchString(id) {
			continue
		}
		streams := r.streams[id]
		if len(streams) == 0 {
			streams = []string{id}
		}
		c := camera{id, raw.FPS, raw.Detect, streams}
		s.Cameras = append(s.Cameras, c)
		cams[id] = c
	}
	sort.Slice(s.Cameras, func(i, j int) bool { return s.Cameras[i].ID < s.Cameras[j].ID })
	var rows []event
	if err := r.json(ctx, "GET", "events", url.Values{"limit": {"60"}, "include_thumbnails": {"0"}, "sort": {"date_desc"}}, nil, &rows); err != nil {
		return state{}, err
	}
	events := map[string]event{}
	for _, e := range rows {
		if _, ok := cams[e.Camera]; !ok || !identifier.MatchString(e.ID) || e.Start <= 0 {
			continue
		}
		s.Events = append(s.Events, e)
		events[e.ID] = e
		if len(s.Events) == 60 {
			break
		}
	}
	s.Updated = time.Now().UnixMilli()
	r.mu.Lock()
	r.cams = cams
	r.events = events
	r.mu.Unlock()
	return s, nil
}

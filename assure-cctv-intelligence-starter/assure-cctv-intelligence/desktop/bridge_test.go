package main

import (
	"bytes"
	"crypto/x509"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

func TestRecorderAddress(t *testing.T) {
	for _, v := range []string{"http://nvr.local:5000", "https://name:secret@nvr/", "https://nvr/path?value=password", "https://github.com/blakeblackshear/frigate", "https://nvr/a/../api", "ftp://nvr", "https://nvr/#fragment"} {
		if _, err := recorderURL(v); err == nil {
			t.Errorf("accepted %q", v)
		}
	}
	u, err := recorderURL(" https://nvr.example:8971/site/ ")
	if err != nil || u.String() != "https://nvr.example:8971/site" {
		t.Fatal(u, err)
	}
}
func call(a *bridge, method, path string, body any, modify func(*http.Request)) *httptest.ResponseRecorder {
	data, _ := json.Marshal(body)
	r := httptest.NewRequest(method, "http://"+a.host+a.prefix+path, bytes.NewReader(data))
	if method == "POST" {
		r.Header.Set("Origin", "http://"+a.host)
		r.Header.Set("Content-Type", "application/json")
	}
	if modify != nil {
		modify(r)
	}
	w := httptest.NewRecorder()
	a.ServeHTTP(w, r)
	return w
}
func TestDesktopBoundary(t *testing.T) {
	a := newBridge("127.0.0.1:1234", "/app/secret/", "LOCAL", nil)
	for _, c := range []struct {
		method, path string
		modify       func(*http.Request)
		status       int
	}{{"GET", "", nil, 200}, {"GET", "", func(r *http.Request) { r.Host = "other" }, 404}, {"GET", "", func(r *http.Request) { r.URL.Path = "/" }, 404}, {"POST", "api/disconnect", func(r *http.Request) { r.Header.Del("Origin") }, 403}, {"POST", "api/connect", func(r *http.Request) { r.Header.Set("Content-Type", "text/plain") }, 403}, {"GET", "api/state", func(r *http.Request) { r.Header.Set("Sec-Fetch-Site", "cross-site") }, 403}} {
		w := call(a, c.method, c.path, nil, c.modify)
		if w.Code != c.status || w.Header().Get("Cache-Control") != "no-store" || w.Header().Get("Access-Control-Allow-Origin") != "" {
			t.Fatalf("%s %s: %d", c.method, c.path, w.Code)
		}
	}
}
func TestRecorderContract(t *testing.T) {
	var expire atomic.Bool
	var requests atomic.Int32
	nvr := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		if r.URL.Path == "/site/api/login" {
			var p map[string]string
			json.NewDecoder(r.Body).Decode(&p)
			if p["user"] != "viewer" || p["password"] != "fixture-only" {
				w.WriteHeader(401)
				return
			}
			http.SetCookie(w, &http.Cookie{Name: "frigate_token", Value: "only-at-recorder", Path: "/", Secure: true, HttpOnly: true})
			return
		}
		c, err := r.Cookie("frigate_token")
		if err != nil || c.Value != "only-at-recorder" || expire.Load() {
			w.WriteHeader(401)
			return
		}
		switch r.URL.Path {
		case "/site/api/config":
			io.WriteString(w, `{"cameras":{"hall":{"live":{"streams":{"Main":"hall_hd"}}}},"private":"never-render"}`)
		case "/site/api/stats":
			io.WriteString(w, `{"service":{"version":"0.18.3"},"cameras":{"hall":{"camera_fps":25,"detection_fps":5}},"cpu_usages":{"cmdline":"never-render"}}`)
		case "/site/api/events":
			if r.URL.Query().Get("limit") != "60" || r.URL.Query().Get("include_thumbnails") != "0" {
				t.Error("unexpected event query")
			}
			io.WriteString(w, `[{"id":"1-a","camera":"hall","label":"person","start_time":100,"end_time":102,"has_clip":true,"has_snapshot":true,"data":{"private":"never-render"}},{"id":"2-b","camera":"outside","label":"car","start_time":101}]`)
		case "/site/api/hall/latest.jpg", "/site/api/events/1-a/snapshot.jpg":
			w.Header().Set("Content-Type", "image/jpeg")
			w.Write([]byte{255, 216, 255, 217})
		case "/site/api/events/1-a/clip.mp4":
			if r.Header.Get("Range") != "bytes=2-4" {
				t.Error("range not passed")
			}
			w.Header().Set("Content-Type", "video/mp4")
			w.Header().Set("Content-Range", "bytes 2-4/8")
			w.WriteHeader(206)
			io.WriteString(w, "mp4")
		case "/site/api/go2rtc/webrtc":
			if r.Method != "POST" || r.URL.Query().Get("src") != "hall_hd" {
				t.Error("unexpected signaling")
			}
			io.WriteString(w, `{"type":"answer","sdp":"v=0\r\n"}`)
		default:
			t.Error("unexpected recorder path", r.URL.Path)
			http.NotFound(w, r)
		}
	}))
	defer nvr.Close()
	roots := x509.NewCertPool()
	roots.AddCert(nvr.Certificate())
	a := newBridge("127.0.0.1:1234", "/app/test/", "", roots)
	defer a.disconnect()
	creds := map[string]string{"address": nvr.URL + "/site/", "user": "viewer", "password": "wrong"}
	check := func(w *httptest.ResponseRecorder, n int) {
		t.Helper()
		if w.Code != n {
			t.Fatalf("want %d, got %d %s", n, w.Code, w.Body.String())
		}
		for _, secret := range []string{"fixture-only", "only-at-recorder", "never-render"} {
			if strings.Contains(w.Body.String(), secret) || w.Header().Get("Set-Cookie") != "" {
				t.Fatal("disclosed private data")
			}
		}
	}
	check(call(a, "POST", "api/connect", creds, nil), 401)
	creds["password"] = "fixture-only"
	w := call(a, "POST", "api/connect", creds, nil)
	check(w, 200)
	var s state
	json.Unmarshal(w.Body.Bytes(), &s)
	if len(s.Events) != 1 || len(s.Cameras) != 1 || s.Cameras[0].Streams[0] != "hall_hd" || !s.Connected {
		t.Fatal(s)
	}
	check(call(a, "GET", "api/media/camera/hall", nil, nil), 200)
	check(call(a, "GET", "api/media/snapshot/1-a", nil, nil), 200)
	w = call(a, "GET", "api/media/clip/1-a", nil, func(r *http.Request) { r.Header.Set("Range", "bytes=2-4") })
	check(w, 206)
	if w.Header().Get("Content-Range") != "bytes 2-4/8" {
		t.Fatal(w.Header())
	}
	before := requests.Load()
	check(call(a, "GET", "api/media/camera/other", nil, nil), 404)
	check(call(a, "GET", "api/media/snapshot/not-listed", nil, nil), 404)
	check(call(a, "POST", "api/live", map[string]string{"camera": "hall", "stream": "other"}, nil), 404)
	if requests.Load() != before {
		t.Fatal("forwarded an unlisted resource")
	}
	check(call(a, "POST", "api/live", map[string]string{"camera": "hall", "stream": "hall_hd", "sdp": "v=0\r\nm=video 9\r\na=recvonly\r\n"}, nil), 200)
	expire.Store(true)
	check(call(a, "GET", "api/state", nil, nil), 401)
	w = call(a, "GET", "api/state", nil, nil)
	check(w, 200)
	if !strings.Contains(w.Body.String(), `"connected":false`) {
		t.Fatal("expired session retained")
	}
	expire.Store(false)
	check(call(a, "POST", "api/connect", creds, nil), 200)
	check(call(a, "POST", "api/disconnect", map[string]string{}, nil), 200)
	check(call(a, "GET", "api/media/camera/hall", nil, nil), 401)
}
func TestTrustAndRedirects(t *testing.T) {
	var followed atomic.Bool
	target := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { followed.Store(true) }))
	defer target.Close()
	src := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, target.URL, 307) }))
	defer src.Close()
	a := newBridge("local", "/app/key/", "", x509.NewCertPool())
	cred := map[string]string{"address": src.URL, "user": "viewer", "password": "test"}
	w := call(a, "POST", "api/connect", cred, nil)
	if w.Code != 502 || !strings.Contains(w.Body.String(), "TLS") {
		t.Fatal(w.Code, w.Body.String())
	}
	a.roots.AddCert(src.Certificate())
	w = call(a, "POST", "api/connect", cred, nil)
	if w.Code != 502 || followed.Load() {
		t.Fatal("redirect followed")
	}
}

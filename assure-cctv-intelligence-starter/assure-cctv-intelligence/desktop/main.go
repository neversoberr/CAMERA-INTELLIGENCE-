// Framewatch desktop shell. No daemon, installer, WebView download or public listener.
package main

import (
	"context"
	"crypto/rand"
	"crypto/x509"
	"encoding/hex"
	"errors"
	"flag"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

func openApp(address string) error {
	if runtime.GOOS != "windows" {
		return errors.New("open the local address above in your browser")
	}
	for _, root := range []string{"ProgramFiles(x86)", "ProgramFiles", "LOCALAPPDATA"} {
		for _, rel := range []string{`Microsoft\Edge\Application\msedge.exe`, `Google\Chrome\Application\chrome.exe`} {
			if base := os.Getenv(root); base != "" {
				name := filepath.Join(base, rel)
				if _, err := os.Stat(name); err == nil {
					if exec.Command(name, "--app="+address).Start() == nil {
						return nil
					}
				}
			}
		}
	}
	return exec.Command(filepath.Join(os.Getenv("SystemRoot"), "explorer.exe"), address).Start()
}

func run() error {
	port := flag.Int("port", 48765, "local port (0: choose one)")
	noBrowser := flag.Bool("no-browser", false, "do not launch the browser window")
	flag.Parse()
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	dir := filepath.Dir(exe)
	html, err := os.ReadFile(filepath.Join(dir, "Framewatch.html"))
	if err != nil {
		return errors.New("Extract the whole ZIP first. Keep Framewatch.exe beside Framewatch.html.")
	}
	// Only the loopback document can read the narrowly scoped local API. Leave the
	// portable file's network-denying policy untouched, including in its worker.
	page, err := desktopHTML(string(html))
	if err != nil {
		return err
	}
	roots, err := x509.SystemCertPool()
	if err != nil || roots == nil {
		roots = x509.NewCertPool()
	}
	if ca, err := os.ReadFile(filepath.Join(dir, "frigate-ca.pem")); err == nil {
		if !roots.AppendCertsFromPEM(ca) {
			return errors.New("frigate-ca.pem is not a PEM certificate")
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	l, err := net.Listen("tcp4", fmt.Sprintf("127.0.0.1:%d", *port))
	if err != nil {
		return errors.New("Local port unavailable. Close the previous Framewatch launcher or select another port.")
	}
	defer l.Close()
	key := make([]byte, 24)
	if _, err = rand.Read(key); err != nil {
		return err
	}
	app := newBridge(l.Addr().String(), "/app/"+hex.EncodeToString(key)+"/", page, roots)
	defer app.disconnect()
	server := &http.Server{Handler: app, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, IdleTimeout: 30 * time.Second, MaxHeaderBytes: 16 << 10}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	done := make(chan struct{})
	go func() {
		defer close(done)
		select {
		case <-ctx.Done():
		case <-app.quit:
		}
		app.disconnect()
		grace, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		if server.Shutdown(grace) != nil {
			server.Close()
		}
	}()
	address := "http://" + app.host + app.prefix + "#frigate"
	fmt.Printf("Framewatch PC | private recorder workspace\nOpen locally: %s\nKeep this launcher open. Close it or press Ctrl+C to quit and forget the recorder session.\n", address)
	if !*noBrowser {
		if err := openApp(address); err != nil {
			fmt.Println("Open the local address above in desktop Edge or Chrome.")
		}
	}
	if err = server.Serve(l); !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	<-done
	return nil
}
func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "Framewatch:", err)
		if runtime.GOOS == "windows" {
			fmt.Print("Press Enter to close.")
			fmt.Scanln()
		}
		os.Exit(1)
	}
}

func desktopHTML(html string) (string, error) {
	const marker = `<meta name="framewatch-runtime" content="file">`
	const offline = "connect-src data: blob:; img-src data: blob:;"
	if strings.Count(html, marker) != 1 || strings.Count(html, offline) != 1 || strings.Count(html, "media-src blob: mediastream:;") != 1 {
		return "", errors.New("The launcher and HTML do not match. Extract them from the same Framewatch ZIP.")
	}
	html = strings.Replace(html, marker, `<meta name="framewatch-runtime" content="desktop">`, 1)
	html = strings.Replace(html, offline, "connect-src 'self' data: blob:; img-src 'self' data: blob:;", 1)
	return strings.Replace(html, "media-src blob: mediastream:;", "media-src 'self' blob: mediastream:;", 1), nil
}

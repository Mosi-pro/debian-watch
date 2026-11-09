// Package term bridges a PTY shell to a WebSocket.
package term

import (
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"os/exec"
	"os/user"
	"strconv"
	"sync"
	"syscall"
	"time"

	"github.com/creack/pty"
	"github.com/gorilla/websocket"
)

var ErrRoot = errors.New("Terminal verweigert: Dienst läuft als root (allow_root = true setzen, wenn gewollt)")

type Options struct {
	Shell     string
	AllowRoot bool
	Origin    func(r *http.Request) bool
}

type resizeMsg struct {
	Type string `json:"type"`
	Cols uint16 `json:"cols"`
	Rows uint16 `json:"rows"`
}

func shellFor(opt Options) string {
	if opt.Shell != "" {
		return opt.Shell
	}
	if u, err := user.Current(); err == nil {
		if sh := loginShell(u.Username); sh != "" {
			return sh
		}
	}
	if sh := os.Getenv("SHELL"); sh != "" {
		return sh
	}
	return "/bin/bash"
}

// Serve upgrades the request and runs a shell until either side closes.
// onStart is called once the shell is running (for the audit log).
func Serve(w http.ResponseWriter, r *http.Request, opt Options, onStart func(shell string, pid int), onEnd func(d time.Duration)) {
	if os.Geteuid() == 0 && !opt.AllowRoot {
		http.Error(w, ErrRoot.Error(), http.StatusForbidden)
		return
	}
	up := websocket.Upgrader{CheckOrigin: opt.Origin, ReadBufferSize: 4096, WriteBufferSize: 4096}
	ws, err := up.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer ws.Close()

	cols, _ := strconv.Atoi(r.URL.Query().Get("cols"))
	rows, _ := strconv.Atoi(r.URL.Query().Get("rows"))
	if cols <= 0 || cols > 500 {
		cols = 80
	}
	if rows <= 0 || rows > 200 {
		rows = 24
	}

	sh := shellFor(opt)
	cmd := exec.Command(sh, "-l")
	cmd.Env = append(os.Environ(), "TERM=xterm-256color", "COLORTERM=truecolor")
	if home, err := os.UserHomeDir(); err == nil {
		cmd.Dir = home
	}
	ptmx, err := pty.StartWithSize(cmd, &pty.Winsize{Cols: uint16(cols), Rows: uint16(rows)})
	if err != nil {
		ws.WriteMessage(websocket.TextMessage, []byte("\r\nShell konnte nicht gestartet werden: "+err.Error()+"\r\n"))
		return
	}
	start := time.Now()
	if onStart != nil {
		onStart(sh, cmd.Process.Pid)
	}
	var once sync.Once
	closeAll := func() {
		once.Do(func() {
			ptmx.Close()
			if cmd.Process != nil {
				cmd.Process.Signal(syscall.SIGHUP)
				go func() {
					time.Sleep(2 * time.Second)
					cmd.Process.Kill()
				}()
			}
		})
	}
	defer func() {
		closeAll()
		cmd.Wait()
		if onEnd != nil {
			onEnd(time.Since(start))
		}
	}()

	// PTY -> WebSocket
	go func() {
		defer closeAll()
		buf := make([]byte, 16*1024)
		for {
			n, err := ptmx.Read(buf)
			if n > 0 {
				if werr := ws.WriteMessage(websocket.BinaryMessage, buf[:n]); werr != nil {
					return
				}
			}
			if err != nil {
				ws.WriteControl(websocket.CloseMessage,
					websocket.FormatCloseMessage(websocket.CloseNormalClosure, "shell beendet"), time.Now().Add(time.Second))
				return
			}
		}
	}()

	// keepalive
	done := make(chan struct{})
	defer close(done)
	go func() {
		t := time.NewTicker(30 * time.Second)
		defer t.Stop()
		for {
			select {
			case <-done:
				return
			case <-t.C:
				ws.WriteControl(websocket.PingMessage, nil, time.Now().Add(5*time.Second))
			}
		}
	}()
	ws.SetReadLimit(1 << 20)
	ws.SetReadDeadline(time.Now().Add(90 * time.Second))
	ws.SetPongHandler(func(string) error { ws.SetReadDeadline(time.Now().Add(90 * time.Second)); return nil })

	// WebSocket -> PTY. Binary = keystrokes, text = JSON control (resize).
	for {
		mt, data, err := ws.ReadMessage()
		if err != nil {
			return
		}
		ws.SetReadDeadline(time.Now().Add(90 * time.Second))
		switch mt {
		case websocket.BinaryMessage:
			if _, err := ptmx.Write(data); err != nil {
				return
			}
		case websocket.TextMessage:
			var m resizeMsg
			if json.Unmarshal(data, &m) == nil && m.Type == "resize" && m.Cols > 0 && m.Rows > 0 && m.Cols < 500 && m.Rows < 200 {
				pty.Setsize(ptmx, &pty.Winsize{Cols: m.Cols, Rows: m.Rows})
			}
		}
	}
}

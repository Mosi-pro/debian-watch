package server

import (
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/gorilla/websocket"
	"github.com/mosi-pro/debian-watch/internal/auth"
	"github.com/mosi-pro/debian-watch/internal/term"
)

var errBadLogin = errors.New("Benutzer, Passwort oder Code falsch")

// apiState tells the frontend which screen to show.
func (s *Server) apiState(w http.ResponseWriter, r *http.Request) {
	out := map[string]any{"setup_needed": s.users.Empty(), "version": s.version}
	if c, err := r.Cookie(cookieName); err == nil {
		if sess, ok := s.sessions.Get(c.Value); ok {
			u, _ := s.users.Get(sess.User)
			out["user"] = sess.User
			out["csrf"] = sess.CSRF
			out["totp_enabled"] = u.TOTPEnabled
		}
	}
	writeJSON(w, 200, out)
}

func (s *Server) startSession(w http.ResponseWriter, name string) {
	tok, sess := s.sessions.New(name)
	s.setCookie(w, tok, sess.Expires)
}

// apiSetup creates the first admin; only possible while no user exists.
func (s *Server) apiSetup(w http.ResponseWriter, r *http.Request) {
	var in struct{ User, Password string }
	if err := readJSON(r, &in); err != nil {
		fail(w, 400, err)
		return
	}
	if !s.users.Empty() {
		fail(w, 409, errors.New("Setup bereits abgeschlossen"))
		return
	}
	if err := s.users.Create(in.User, in.Password); err != nil {
		fail(w, 400, err)
		return
	}
	s.audit.Add("setup", in.User, s.ipStr(r), "erster Benutzer angelegt")
	s.startSession(w, in.User)
	writeJSON(w, 200, map[string]bool{"ok": true})
}

func (s *Server) apiLogin(w http.ResponseWriter, r *http.Request) {
	var in struct{ User, Password, Code string }
	if err := readJSON(r, &in); err != nil {
		fail(w, 400, err)
		return
	}
	ip := s.ipStr(r)
	if d, blocked := s.byIP.Blocked(ip); blocked {
		fail(w, 429, fmt.Errorf("Zu viele Versuche, bitte %d s warten", int(d.Seconds())+1))
		return
	}
	if d, blocked := s.byUser.Blocked(in.User); blocked {
		s.audit.Add("login_locked", in.User, ip, "")
		fail(w, 429, fmt.Errorf("Konto vorübergehend gesperrt, bitte %d s warten", int(d.Seconds())+1))
		return
	}
	u, ok := s.users.Get(in.User)
	hash := u.Hash
	if !ok { // constant-ish time for unknown users
		hash, _ = auth.HashPassword("dummy-password")
	}
	pwOK := auth.VerifyPassword(in.Password, hash) && ok
	if pwOK && u.TOTPEnabled {
		if in.Code == "" {
			writeJSON(w, 401, map[string]any{"error": "2FA-Code erforderlich", "need_totp": true})
			return
		}
		ctr, valid := auth.VerifyTOTP(u.TOTPSecret, in.Code, time.Now())
		if valid && ctr <= u.LastTOTP { // replay
			valid = false
		}
		if valid {
			s.users.Update(u.Name, func(x *auth.User) error { x.LastTOTP = ctr; return nil })
		}
		pwOK = valid
	}
	if !pwOK {
		s.byIP.Fail(ip)
		s.byUser.Fail(in.User)
		s.audit.Add("login_fail", in.User, ip, "")
		fail(w, 401, errBadLogin)
		return
	}
	s.byIP.Success(ip)
	s.byUser.Success(in.User)
	s.audit.Add("login", in.User, ip, "")
	s.startSession(w, in.User)
	writeJSON(w, 200, map[string]bool{"ok": true})
}

func (s *Server) apiLogout(w http.ResponseWriter, r *http.Request, sess auth.Session, tok string) {
	s.sessions.Delete(tok)
	s.setCookie(w, "", time.Unix(0, 0))
	s.audit.Add("logout", sess.User, s.ipStr(r), "")
	writeJSON(w, 200, map[string]bool{"ok": true})
}

func (s *Server) apiStream(w http.ResponseWriter, r *http.Request, _ auth.Session, _ string) {
	fl, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", 500)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("X-Accel-Buffering", "no")
	ch, cancel := s.metrics.Subscribe()
	defer cancel()
	send := func(sm any) bool {
		b, _ := jsonMarshal(sm)
		_, err := fmt.Fprintf(w, "data: %s\n\n", b)
		fl.Flush()
		return err == nil
	}
	if l := s.metrics.Last(); l.T != 0 {
		send(l)
	}
	hb := time.NewTicker(20 * time.Second)
	defer hb.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case sm := <-ch:
			if !send(sm) {
				return
			}
		case <-hb.C:
			fmt.Fprint(w, ": hb\n\n")
			fl.Flush()
		}
	}
}

func (s *Server) apiTerm(w http.ResponseWriter, r *http.Request, sess auth.Session, _ string) {
	if !websocket.IsWebSocketUpgrade(r) {
		http.Error(w, "websocket required", 400)
		return
	}
	ip := s.ipStr(r)
	term.Serve(w, r, term.Options{Shell: s.cfg.Shell, AllowRoot: s.cfg.AllowRoot, Origin: sameHost},
		func(shell string, pid int) {
			s.audit.Add("term_start", sess.User, ip, fmt.Sprintf("%s pid=%d", shell, pid))
		},
		func(d time.Duration) { s.audit.Add("term_end", sess.User, ip, d.Round(time.Second).String()) })
}

func (s *Server) apiPassword(w http.ResponseWriter, r *http.Request, sess auth.Session, tok string) {
	var in struct{ Old, New string }
	if err := readJSON(r, &in); err != nil {
		fail(w, 400, err)
		return
	}
	u, _ := s.users.Get(sess.User)
	if !auth.VerifyPassword(in.Old, u.Hash) {
		fail(w, 403, errors.New("Aktuelles Passwort falsch"))
		return
	}
	if err := s.users.SetPassword(sess.User, in.New); err != nil {
		fail(w, 400, err)
		return
	}
	s.sessions.DeleteUser(sess.User, tok)
	s.audit.Add("password_change", sess.User, s.ipStr(r), "")
	writeJSON(w, 200, map[string]bool{"ok": true})
}

func (s *Server) apiTOTPStart(w http.ResponseWriter, r *http.Request, sess auth.Session, _ string) {
	secret := auth.NewTOTPSecret()
	err := s.users.Update(sess.User, func(u *auth.User) error {
		if u.TOTPEnabled {
			return errors.New("2FA ist bereits aktiv")
		}
		u.TOTPSecret = secret
		return nil
	})
	if err != nil {
		fail(w, 400, err)
		return
	}
	writeJSON(w, 200, map[string]string{"secret": secret, "uri": auth.TOTPURI("MosiDeck", sess.User, secret)})
}

func (s *Server) apiTOTPEnable(w http.ResponseWriter, r *http.Request, sess auth.Session, _ string) {
	var in struct{ Code string }
	if err := readJSON(r, &in); err != nil {
		fail(w, 400, err)
		return
	}
	err := s.users.Update(sess.User, func(u *auth.User) error {
		if u.TOTPSecret == "" {
			return errors.New("Erst 2FA-Einrichtung starten")
		}
		ctr, ok := auth.VerifyTOTP(u.TOTPSecret, in.Code, time.Now())
		if !ok {
			return errors.New("Code falsch")
		}
		u.TOTPEnabled, u.LastTOTP = true, ctr
		return nil
	})
	if err != nil {
		fail(w, 400, err)
		return
	}
	s.audit.Add("totp_enable", sess.User, s.ipStr(r), "")
	writeJSON(w, 200, map[string]bool{"ok": true})
}

func (s *Server) apiTOTPDisable(w http.ResponseWriter, r *http.Request, sess auth.Session, _ string) {
	var in struct{ Password string }
	if err := readJSON(r, &in); err != nil {
		fail(w, 400, err)
		return
	}
	u, _ := s.users.Get(sess.User)
	if !auth.VerifyPassword(in.Password, u.Hash) {
		fail(w, 403, errors.New("Passwort falsch"))
		return
	}
	s.users.Update(sess.User, func(u *auth.User) error { u.TOTPEnabled, u.TOTPSecret = false, ""; return nil })
	s.audit.Add("totp_disable", sess.User, s.ipStr(r), "")
	writeJSON(w, 200, map[string]bool{"ok": true})
}

func (s *Server) apiUsers(w http.ResponseWriter, r *http.Request, _ auth.Session, _ string) {
	type row struct {
		Name string `json:"name"`
		TOTP bool   `json:"totp"`
	}
	var out []row
	for _, n := range s.users.List() {
		u, _ := s.users.Get(n)
		out = append(out, row{n, u.TOTPEnabled})
	}
	writeJSON(w, 200, out)
}

func (s *Server) apiUserAdd(w http.ResponseWriter, r *http.Request, sess auth.Session, _ string) {
	var in struct{ User, Password string }
	if err := readJSON(r, &in); err != nil {
		fail(w, 400, err)
		return
	}
	if err := s.users.Create(in.User, in.Password); err != nil {
		fail(w, 400, err)
		return
	}
	s.audit.Add("user_add", sess.User, s.ipStr(r), in.User)
	writeJSON(w, 200, map[string]bool{"ok": true})
}

func (s *Server) apiUserDel(w http.ResponseWriter, r *http.Request, sess auth.Session, _ string) {
	name := r.PathValue("name")
	if name == sess.User {
		fail(w, 400, errors.New("Du kannst dich nicht selbst löschen"))
		return
	}
	if err := s.users.Delete(name); err != nil {
		fail(w, 400, err)
		return
	}
	s.sessions.DeleteUser(name, "")
	s.audit.Add("user_del", sess.User, s.ipStr(r), name)
	writeJSON(w, 200, map[string]bool{"ok": true})
}

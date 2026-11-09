package webcore

import (
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/mosi-pro/debian-watch/internal/audit"
	"github.com/mosi-pro/debian-watch/internal/auth"
)

var errBadLogin = errors.New("Benutzer, Passwort oder Code falsch")

// apiState tells the frontend which screen to show.
func (c *Core) apiState(w http.ResponseWriter, r *http.Request) {
	out := map[string]any{"setup_needed": c.Users.Empty(), "version": c.Opt.Version}
	if ck, err := r.Cookie(c.cookie()); err == nil {
		if sess, ok := c.Sessions.Get(ck.Value); ok {
			u, _ := c.Users.Get(sess.User)
			out["user"] = sess.User
			out["csrf"] = sess.CSRF
			out["totp_enabled"] = u.TOTPEnabled
		}
	}
	WriteJSON(w, 200, out)
}

func (c *Core) startSession(w http.ResponseWriter, name string) {
	tok, sess := c.Sessions.New(name)
	c.setCookie(w, tok, sess.Expires)
}

// apiSetup creates the first admin; only possible while no user exists.
func (c *Core) apiSetup(w http.ResponseWriter, r *http.Request) {
	var in struct{ User, Password string }
	if err := ReadJSON(r, &in); err != nil {
		Fail(w, 400, err)
		return
	}
	if !c.Users.Empty() {
		Fail(w, 409, errors.New("Setup bereits abgeschlossen"))
		return
	}
	if err := c.Users.Create(in.User, in.Password); err != nil {
		Fail(w, 400, err)
		return
	}
	c.Audit.Add("setup", in.User, c.IPStr(r), "erster Benutzer angelegt")
	c.startSession(w, in.User)
	WriteJSON(w, 200, map[string]bool{"ok": true})
}

func (c *Core) apiLogin(w http.ResponseWriter, r *http.Request) {
	var in struct{ User, Password, Code string }
	if err := ReadJSON(r, &in); err != nil {
		Fail(w, 400, err)
		return
	}
	ip := c.IPStr(r)
	if d, blocked := c.ByIP.Blocked(ip); blocked {
		Fail(w, 429, fmt.Errorf("Zu viele Versuche, bitte %d s warten", int(d.Seconds())+1))
		return
	}
	if d, blocked := c.ByUser.Blocked(in.User); blocked {
		c.Audit.Add("login_locked", in.User, ip, "")
		Fail(w, 429, fmt.Errorf("Konto vorübergehend gesperrt, bitte %d s warten", int(d.Seconds())+1))
		return
	}
	u, ok := c.Users.Get(in.User)
	hash := u.Hash
	if !ok { // constant-ish time for unknown users
		hash, _ = auth.HashPassword("dummy-password")
	}
	pwOK := auth.VerifyPassword(in.Password, hash) && ok
	if pwOK && u.TOTPEnabled {
		if in.Code == "" {
			WriteJSON(w, 401, map[string]any{"error": "2FA-Code erforderlich", "need_totp": true})
			return
		}
		ctr, valid := auth.VerifyTOTP(u.TOTPSecret, in.Code, time.Now())
		if valid && ctr <= u.LastTOTP { // replay
			valid = false
		}
		if valid {
			c.Users.Update(u.Name, func(x *auth.User) error { x.LastTOTP = ctr; return nil })
		}
		pwOK = valid
	}
	if !pwOK {
		c.ByIP.Fail(ip)
		c.ByUser.Fail(in.User)
		c.Audit.Add("login_fail", in.User, ip, "")
		Fail(w, 401, errBadLogin)
		return
	}
	c.ByIP.Success(ip)
	c.ByUser.Success(in.User)
	c.Audit.Add("login", in.User, ip, "")
	c.startSession(w, in.User)
	WriteJSON(w, 200, map[string]bool{"ok": true})
}

func (c *Core) apiLogout(w http.ResponseWriter, r *http.Request, sess auth.Session, tok string) {
	c.Sessions.Delete(tok)
	c.setCookie(w, "", time.Unix(0, 0))
	c.Audit.Add("logout", sess.User, c.IPStr(r), "")
	WriteJSON(w, 200, map[string]bool{"ok": true})
}

func (c *Core) apiPassword(w http.ResponseWriter, r *http.Request, sess auth.Session, tok string) {
	var in struct{ Old, New string }
	if err := ReadJSON(r, &in); err != nil {
		Fail(w, 400, err)
		return
	}
	u, _ := c.Users.Get(sess.User)
	if !auth.VerifyPassword(in.Old, u.Hash) {
		Fail(w, 403, errors.New("Aktuelles Passwort falsch"))
		return
	}
	if err := c.Users.SetPassword(sess.User, in.New); err != nil {
		Fail(w, 400, err)
		return
	}
	c.Sessions.DeleteUser(sess.User, tok)
	c.Audit.Add("password_change", sess.User, c.IPStr(r), "")
	WriteJSON(w, 200, map[string]bool{"ok": true})
}

func (c *Core) apiTOTPStart(w http.ResponseWriter, r *http.Request, sess auth.Session, _ string) {
	secret := auth.NewTOTPSecret()
	err := c.Users.Update(sess.User, func(u *auth.User) error {
		if u.TOTPEnabled {
			return errors.New("2FA ist bereits aktiv")
		}
		u.TOTPSecret = secret
		return nil
	})
	if err != nil {
		Fail(w, 400, err)
		return
	}
	WriteJSON(w, 200, map[string]string{"secret": secret, "uri": auth.TOTPURI(c.Opt.Name, sess.User, secret)})
}

func (c *Core) apiTOTPEnable(w http.ResponseWriter, r *http.Request, sess auth.Session, _ string) {
	var in struct{ Code string }
	if err := ReadJSON(r, &in); err != nil {
		Fail(w, 400, err)
		return
	}
	err := c.Users.Update(sess.User, func(u *auth.User) error {
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
		Fail(w, 400, err)
		return
	}
	c.Audit.Add("totp_enable", sess.User, c.IPStr(r), "")
	WriteJSON(w, 200, map[string]bool{"ok": true})
}

func (c *Core) apiTOTPDisable(w http.ResponseWriter, r *http.Request, sess auth.Session, _ string) {
	var in struct{ Password string }
	if err := ReadJSON(r, &in); err != nil {
		Fail(w, 400, err)
		return
	}
	u, _ := c.Users.Get(sess.User)
	if !auth.VerifyPassword(in.Password, u.Hash) {
		Fail(w, 403, errors.New("Passwort falsch"))
		return
	}
	c.Users.Update(sess.User, func(u *auth.User) error { u.TOTPEnabled, u.TOTPSecret = false, ""; return nil })
	c.Audit.Add("totp_disable", sess.User, c.IPStr(r), "")
	WriteJSON(w, 200, map[string]bool{"ok": true})
}

func (c *Core) apiUsers(w http.ResponseWriter, r *http.Request, _ auth.Session, _ string) {
	type row struct {
		Name string `json:"name"`
		TOTP bool   `json:"totp"`
	}
	var out []row
	for _, n := range c.Users.List() {
		u, _ := c.Users.Get(n)
		out = append(out, row{n, u.TOTPEnabled})
	}
	WriteJSON(w, 200, out)
}

func (c *Core) apiUserAdd(w http.ResponseWriter, r *http.Request, sess auth.Session, _ string) {
	var in struct{ User, Password string }
	if err := ReadJSON(r, &in); err != nil {
		Fail(w, 400, err)
		return
	}
	if err := c.Users.Create(in.User, in.Password); err != nil {
		Fail(w, 400, err)
		return
	}
	c.Audit.Add("user_add", sess.User, c.IPStr(r), in.User)
	WriteJSON(w, 200, map[string]bool{"ok": true})
}

func (c *Core) apiUserDel(w http.ResponseWriter, r *http.Request, sess auth.Session, _ string) {
	name := r.PathValue("name")
	if name == sess.User {
		Fail(w, 400, errors.New("Du kannst dich nicht selbst löschen"))
		return
	}
	if err := c.Users.Delete(name); err != nil {
		Fail(w, 400, err)
		return
	}
	c.Sessions.DeleteUser(name, "")
	c.Audit.Add("user_del", sess.User, c.IPStr(r), name)
	WriteJSON(w, 200, map[string]bool{"ok": true})
}

// Mount registriert Login/Setup/Konto-Endpunkte unter /api/.
func (c *Core) Mount(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/state", c.apiState)
	mux.HandleFunc("GET /ca.crt", c.serveCert)
	mux.HandleFunc("POST /api/setup", c.apiSetup)
	mux.HandleFunc("POST /api/login", c.apiLogin)
	mux.HandleFunc("POST /api/logout", c.Authed(c.apiLogout))
	mux.HandleFunc("POST /api/password", c.Authed(c.apiPassword))
	mux.HandleFunc("POST /api/totp/start", c.Authed(c.apiTOTPStart))
	mux.HandleFunc("POST /api/totp/enable", c.Authed(c.apiTOTPEnable))
	mux.HandleFunc("POST /api/totp/disable", c.Authed(c.apiTOTPDisable))
	mux.HandleFunc("GET /api/users", c.Authed(c.apiUsers))
	mux.HandleFunc("POST /api/users", c.Authed(c.apiUserAdd))
	mux.HandleFunc("DELETE /api/users/{name}", c.Authed(c.apiUserDel))
	mux.HandleFunc("GET /api/audit", c.Authed(func(w http.ResponseWriter, r *http.Request, _ auth.Session, _ string) {
		WriteJSON(w, 200, audit.Tail(c.AuditPath, 200))
	}))
}

// serveCert liefert das (oeffentliche) Self-Signed-Zertifikat zum Installieren auf Geraeten.
func (c *Core) serveCert(w http.ResponseWriter, r *http.Request) {
	if c.Opt.TLSCert != "" || !c.TLS {
		http.NotFound(w, r)
		return
	}
	b, err := os.ReadFile(filepath.Join(c.Opt.DataDir, strings.ToLower(c.Opt.Name)+".crt"))
	if err != nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "application/x-x509-ca-cert")
	w.Header().Set("Content-Disposition", `attachment; filename="`+strings.ToLower(c.Opt.Name)+`.crt"`)
	w.Write(b)
}

// Package sailapp ist MosiSail: Segel-Cockpit mit Wetter, Karte, Logbuch und Saisonabschluss.
package sailapp

import (
	"context"
	"encoding/csv"
	"errors"
	"fmt"
	"io/fs"
	"net/http"
	"strconv"
	"strings"

	"github.com/mosi-pro/debian-watch/internal/auth"
	"github.com/mosi-pro/debian-watch/internal/config"
	"github.com/mosi-pro/debian-watch/internal/sail"
	"github.com/mosi-pro/debian-watch/internal/webcore"
	"github.com/mosi-pro/debian-watch/web"
)

// CSP erlaubt zusätzlich die Kartenkacheln (OpenStreetMap, CARTO).
const csp = "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://*.basemaps.cartocdn.com; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"

type App struct {
	core    *webcore.Core
	store   *sail.Store
	weather *sail.Weather
}

func New(cfg config.Config, version string) (*App, error) {
	core, err := webcore.New(webcore.Options{
		Name: "MosiSail", Listen: cfg.Listen, RedirectHTTP: cfg.RedirectHTTP, Hostname: cfg.Hostname,
		DataDir: cfg.DataDir, TLSCert: cfg.TLSCert, TLSKey: cfg.TLSKey, DisableTLS: cfg.DisableTLS,
		AllowPublic: cfg.AllowPublic, TrustProxy: cfg.TrustProxy, SessionHours: cfg.SessionHours,
		CSP: csp, Version: version,
	})
	if err != nil {
		return nil, err
	}
	st, err := sail.OpenStore(cfg.DataDir)
	if err != nil {
		return nil, err
	}
	return &App{core: core, store: st, weather: sail.NewWeather(cfg.WeatherURL)}, nil
}

func (a *App) Run(ctx context.Context) error { return a.core.Serve(ctx, a.routes()) }

func (a *App) Handler() http.Handler { return a.core.Wrap(a.routes()) }

func (a *App) routes() http.Handler {
	mux := http.NewServeMux()
	static, _ := fs.Sub(web.FS, "sail")
	mux.Handle("/", http.FileServer(http.FS(static)))
	a.core.Mount(mux)

	au := a.core.Authed
	mux.HandleFunc("GET /api/weather/current", au(a.current))
	mux.HandleFunc("GET /api/weather/history", au(a.history))
	mux.HandleFunc("GET /api/weather/forecast", au(a.forecast))

	mux.HandleFunc("GET /api/logbook", au(a.logbook))
	mux.HandleFunc("POST /api/logbook", au(a.entryAdd))
	mux.HandleFunc("PUT /api/logbook/{id}", au(a.entryUpdate))
	mux.HandleFunc("DELETE /api/logbook/{id}", au(a.entryDelete))
	mux.HandleFunc("POST /api/seasons/{year}/close", au(a.seasonClose))
	mux.HandleFunc("DELETE /api/seasons/{year}", au(a.seasonReopen))
	mux.HandleFunc("GET /api/export", au(a.export))
	return mux
}

func (a *App) current(w http.ResponseWriter, r *http.Request, _ auth.Session, _ string) {
	c, err := a.weather.Current(r.Context())
	if err != nil {
		webcore.Fail(w, http.StatusBadGateway, fmt.Errorf("Wetterdaten nicht erreichbar: %w", err))
		return
	}
	webcore.WriteJSON(w, 200, c)
}

func (a *App) history(w http.ResponseWriter, r *http.Request, _ auth.Session, _ string) {
	days, _ := strconv.Atoi(r.URL.Query().Get("days"))
	h, stale, err := a.weather.History(r.Context(), days)
	if err != nil {
		webcore.Fail(w, http.StatusBadGateway, err)
		return
	}
	webcore.WriteJSON(w, 200, map[string]any{"points": h, "stale": stale})
}

func (a *App) forecast(w http.ResponseWriter, r *http.Request, _ auth.Session, _ string) {
	f, stale, err := a.weather.Forecast(r.Context())
	if err != nil {
		webcore.Fail(w, http.StatusBadGateway, fmt.Errorf("Vorhersage nicht erreichbar: %w", err))
		return
	}
	webcore.WriteJSON(w, 200, map[string]any{"forecast": f, "stale": stale})
}

func yearParam(r *http.Request, v string) (int, error) {
	y, err := strconv.Atoi(v)
	if err != nil || y < 1990 || y > 2200 {
		return 0, errors.New("ungültiges Jahr")
	}
	return y, nil
}

func (a *App) logbook(w http.ResponseWriter, r *http.Request, _ auth.Session, _ string) {
	y, err := yearParam(r, r.URL.Query().Get("year"))
	if err != nil {
		webcore.Fail(w, 400, err)
		return
	}
	es, season := a.store.Year(y)
	out := map[string]any{"year": y, "entries": es, "years": a.store.Years(), "types": sail.Types, "closed": season != nil}
	if season != nil {
		out["season"] = season
		out["stats"] = season.Stats // eingefroren
	} else {
		out["stats"] = sail.Compute(es)
	}
	if es == nil {
		out["entries"] = []sail.Entry{}
	}
	webcore.WriteJSON(w, 200, out)
}

func (a *App) status(err error) int {
	switch {
	case errors.Is(err, sail.ErrClosed):
		return http.StatusConflict
	case errors.Is(err, sail.ErrNotFound):
		return http.StatusNotFound
	}
	return http.StatusBadRequest
}

func (a *App) entryAdd(w http.ResponseWriter, r *http.Request, s auth.Session, _ string) {
	var e sail.Entry
	if err := webcore.ReadJSON(r, &e); err != nil {
		webcore.Fail(w, 400, err)
		return
	}
	out, err := a.store.Add(e)
	if err != nil {
		webcore.Fail(w, a.status(err), err)
		return
	}
	a.core.Audit.Add("log_add", s.User, a.core.IPStr(r), out.Date+" "+out.Title)
	webcore.WriteJSON(w, 200, out)
}

func (a *App) entryUpdate(w http.ResponseWriter, r *http.Request, s auth.Session, _ string) {
	var e sail.Entry
	if err := webcore.ReadJSON(r, &e); err != nil {
		webcore.Fail(w, 400, err)
		return
	}
	out, err := a.store.Update(r.PathValue("id"), e)
	if err != nil {
		webcore.Fail(w, a.status(err), err)
		return
	}
	a.core.Audit.Add("log_edit", s.User, a.core.IPStr(r), out.Date+" "+out.Title)
	webcore.WriteJSON(w, 200, out)
}

func (a *App) entryDelete(w http.ResponseWriter, r *http.Request, s auth.Session, _ string) {
	if err := a.store.Delete(r.PathValue("id")); err != nil {
		webcore.Fail(w, a.status(err), err)
		return
	}
	a.core.Audit.Add("log_delete", s.User, a.core.IPStr(r), r.PathValue("id"))
	webcore.WriteJSON(w, 200, map[string]bool{"ok": true})
}

func (a *App) seasonClose(w http.ResponseWriter, r *http.Request, s auth.Session, _ string) {
	y, err := yearParam(r, r.PathValue("year"))
	if err != nil {
		webcore.Fail(w, 400, err)
		return
	}
	var in struct{ Note string }
	webcore.ReadJSON(r, &in)
	se, err := a.store.CloseSeason(y, in.Note, s.User)
	if err != nil {
		webcore.Fail(w, 400, err)
		return
	}
	a.core.Audit.Add("season_close", s.User, a.core.IPStr(r), strconv.Itoa(y))
	webcore.WriteJSON(w, 200, se)
}

func (a *App) seasonReopen(w http.ResponseWriter, r *http.Request, s auth.Session, _ string) {
	y, err := yearParam(r, r.PathValue("year"))
	if err != nil {
		webcore.Fail(w, 400, err)
		return
	}
	if err := a.store.ReopenSeason(y); err != nil {
		webcore.Fail(w, 400, err)
		return
	}
	a.core.Audit.Add("season_reopen", s.User, a.core.IPStr(r), strconv.Itoa(y))
	webcore.WriteJSON(w, 200, map[string]bool{"ok": true})
}

// export: ?year=2026&format=csv|json
func (a *App) export(w http.ResponseWriter, r *http.Request, _ auth.Session, _ string) {
	y, err := yearParam(r, r.URL.Query().Get("year"))
	if err != nil {
		webcore.Fail(w, 400, err)
		return
	}
	es, season := a.store.Year(y)
	if r.URL.Query().Get("format") == "csv" {
		w.Header().Set("Content-Type", "text/csv; charset=utf-8")
		w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="logbuch-%d.csv"`, y))
		cw := csv.NewWriter(w)
		cw.Write([]string{"Datum", "Start", "Ende", "Titel", "Art", "Boot", "Crew", "sm", "Stunden", "Wind Ø kn", "Wind max kn", "Windrichtung", "Notizen"})
		for _, e := range es {
			cw.Write([]string{csvSafe(e.Date), e.Start, e.End, csvSafe(e.Title), e.Type, csvSafe(e.Boat), csvSafe(e.Crew),
				fmt.Sprint(e.Distance), fmt.Sprint(e.Hours), fmt.Sprint(e.WindAvg), fmt.Sprint(e.WindMax), fmt.Sprint(e.WindDir), csvSafe(e.Notes)})
		}
		cw.Flush()
		return
	}
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="logbuch-%d.json"`, y))
	webcore.WriteJSON(w, 200, map[string]any{"year": y, "entries": es, "season": season})
}

// csvSafe verhindert Formel-Injection in Tabellenkalkulationen.
func csvSafe(s string) string {
	if s != "" && strings.ContainsRune("=+-@\t\r", rune(s[0])) {
		return "'" + s
	}
	return s
}

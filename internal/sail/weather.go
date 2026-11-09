// Package sail: Wetter-Proxy (zebrafell/Ammerseewetter + Open-Meteo), Logbuch, Saison-Statistik.
package sail

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Weather proxies and caches the public Ammerseewetter API so that browsers
// never talk to third parties directly (CSP stays tight, their server is spared).
type Weather struct {
	BaseURL string
	client  *http.Client
	mu      sync.Mutex
	cache   map[string]cached
}

type cached struct {
	at   time.Time
	data any
}

func NewWeather(baseURL string) *Weather {
	if baseURL == "" {
		baseURL = "https://zebrafell-server.onrender.com"
	}
	return &Weather{BaseURL: strings.TrimRight(baseURL, "/"), client: &http.Client{Timeout: 45 * time.Second}, cache: map[string]cached{}}
}

// get returns a cached value or computes it. On error a stale value is served if present.
func (w *Weather) get(key string, ttl time.Duration, fn func() (any, error)) (any, bool, error) {
	w.mu.Lock()
	c, ok := w.cache[key]
	w.mu.Unlock()
	if ok && time.Since(c.at) < ttl {
		return c.data, false, nil
	}
	v, err := fn()
	if err != nil {
		if ok {
			return c.data, true, nil
		}
		return nil, false, err
	}
	w.mu.Lock()
	w.cache[key] = cached{time.Now(), v}
	w.mu.Unlock()
	return v, false, nil
}

func (w *Weather) fetchJSON(ctx context.Context, url string, out any) error {
	var err error
	for attempt := 0; attempt < 3; attempt++ {
		if attempt > 0 { // kurzer Backoff bei 429/5xx/Netzfehlern
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(time.Duration(attempt*attempt) * 2 * time.Second):
			}
		}
		var retry bool
		if retry, err = w.fetchOnce(ctx, url, out); err == nil || !retry {
			return err
		}
	}
	return err
}

func (w *Weather) fetchOnce(ctx context.Context, url string, out any) (retry bool, err error) {
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	req.Header.Set("User-Agent", "MosiSail")
	resp, err := w.client.Do(req)
	if err != nil {
		return true, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		host := resp.Request.URL.Host
		return resp.StatusCode == 429 || resp.StatusCode >= 500, fmt.Errorf("%s: %s", host, resp.Status)
	}
	return false, json.NewDecoder(io.LimitReader(resp.Body, 4<<20)).Decode(out)
}

// ---------- aktuelles Wetter ----------

type Station struct {
	Time     string   `json:"time,omitempty"`
	WindKn   *float64 `json:"wind_kn"`
	GustKn   *float64 `json:"gust_kn"`
	WindDir  *float64 `json:"wind_dir"`
	AirTemp  *float64 `json:"air_temp"`
	Humidity *float64 `json:"humidity"`
}

type Current struct {
	Station  Station  `json:"station"` // Herrsching
	Buoy     Station  `json:"buoy"`    // Ammerseeboje
	LakeTemp *float64 `json:"lake_temp"`
	Pressure *float64 `json:"pressure"`
	Rain     *float64 `json:"rain"`
	Rain24h  *float64 `json:"rain_24h"`
	Pegel    *struct {
		Cm   float64 `json:"cm"`
		NHN  string  `json:"nhn"`
		Time string  `json:"time"`
	} `json:"pegel"`
	TempMinMax *struct {
		AirMin, AirMax, LakeMin, LakeMax *float64
	} `json:"temp_minmax"`
	Sun      map[string]string `json:"sun"`
	Fetched  string            `json:"fetched"`
	Stale    bool              `json:"stale"`
	Source   string            `json:"source"`
	Partials []string          `json:"partials,omitempty"`
}

type raw struct {
	ID  string   `json:"_id"`
	D   string   `json:"d"`
	BT  *float64 `json:"bT"`
	BW  *float64 `json:"bW"`
	BWB *float64 `json:"bWB"`
	BWR *float64 `json:"bWR"`
	FA  *float64 `json:"fA"`
	LD  *float64 `json:"lD"`
	R   *float64 `json:"r"`
	TA  *float64 `json:"tA"`
	W   *float64 `json:"w"`
	WBo *float64 `json:"wBo"`
	WR  *float64 `json:"wR"`
	TS  *float64 `json:"tS"`
}

func idTime(id string) string {
	if len(id) >= 8 {
		if s, err := strconv.ParseInt(id[:8], 16, 64); err == nil {
			return time.Unix(s, 0).UTC().Format(time.RFC3339)
		}
	}
	return ""
}

// Current liefert die normalisierten Live-Werte (Cache 2 min).
func (w *Weather) Current(ctx context.Context) (*Current, error) {
	v, stale, err := w.get("current", 2*time.Minute, func() (any, error) { return w.fetchCurrent(ctx) })
	if err != nil {
		return nil, err
	}
	c := *(v.(*Current))
	c.Stale = stale
	return &c, nil
}

func (w *Weather) fetchCurrent(ctx context.Context) (*Current, error) {
	var ov [][]raw
	if err := w.fetchJSON(ctx, w.BaseURL+"/api/mongo/wetterOverview", &ov); err != nil {
		return nil, err
	}
	if len(ov) < 2 || len(ov[0]) == 0 || len(ov[1]) == 0 {
		return nil, fmt.Errorf("wetterOverview: unerwartetes Format")
	}
	full, last := ov[0][0], ov[1][0]
	c := &Current{Source: "Ammerseewetter (zebrafell)", Fetched: time.Now().UTC().Format(time.RFC3339)}
	c.Station = Station{Time: idTime(last.ID), WindKn: last.W, GustKn: last.WBo, WindDir: last.WR, AirTemp: last.TA, Humidity: last.FA}
	c.Buoy = Station{Time: full.D, WindKn: full.BW, GustKn: full.BWB, WindDir: full.BWR, AirTemp: full.BT}
	if full.TA != nil && c.Station.AirTemp == nil {
		c.Station.AirTemp = full.TA
	}
	c.LakeTemp, c.Pressure, c.Rain = full.TS, full.LD, full.R

	// Nebenwerte: einzeln, Fehler brechen nichts ab
	var wg sync.WaitGroup
	var mu sync.Mutex
	part := func(name string, fn func() error) {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := fn(); err != nil {
				mu.Lock()
				c.Partials = append(c.Partials, name)
				mu.Unlock()
			}
		}()
	}
	part("pegel", func() error {
		var p struct {
			Cm   float64 `json:"pegelHeute"`
			NHN  string  `json:"pegelNHNHeute"`
			Time string  `json:"pegelHeuteDat"`
		}
		if err := w.fetchJSON(ctx, w.BaseURL+"/api/mongo/pegelHeute", &p); err != nil {
			return err
		}
		c.Pegel = &struct {
			Cm   float64 `json:"cm"`
			NHN  string  `json:"nhn"`
			Time string  `json:"time"`
		}{p.Cm, p.NHN, p.Time}
		return nil
	})
	part("temp", func() error {
		var t struct{ AMin, AMax, SMin, SMax *float64 }
		var m map[string]*float64
		if err := w.fetchJSON(ctx, w.BaseURL+"/api/mongo/tempMinMaxHeute", &m); err != nil {
			return err
		}
		t.AMin, t.AMax, t.SMin, t.SMax = m["tempAussenHeuteMin"], m["tempAussenHeuteMax"], m["tempSeeHeuteMin"], m["tempSeeHeuteMax"]
		c.TempMinMax = &struct{ AirMin, AirMax, LakeMin, LakeMax *float64 }{t.AMin, t.AMax, t.SMin, t.SMax}
		return nil
	})
	part("regen", func() error {
		var r float64
		if err := w.fetchJSON(ctx, w.BaseURL+"/api/mongo/regen24h", &r); err != nil {
			return err
		}
		c.Rain24h = &r
		return nil
	})
	part("sonne", func() error {
		var s map[string]string
		if err := w.fetchJSON(ctx, w.BaseURL+"/api/mongo/sonne", &s); err != nil {
			return err
		}
		c.Sun = s
		return nil
	})
	wg.Wait()
	return c, nil
}

// ---------- Verlauf ----------

type HistPoint struct {
	T     int64    `json:"t"`
	HWind *float64 `json:"h_wind"`
	HGust *float64 `json:"h_gust"`
	HDir  *float64 `json:"h_dir"`
	UWind *float64 `json:"u_wind"`
	UGust *float64 `json:"u_gust"`
	UDir  *float64 `json:"u_dir"`
}

func (w *Weather) History(ctx context.Context, days int) ([]HistPoint, bool, error) {
	if days < 1 {
		days = 1
	}
	if days > 7 {
		days = 7
	}
	key := "hist" + strconv.Itoa(days)
	v, stale, err := w.get(key, 5*time.Minute, func() (any, error) {
		u := fmt.Sprintf("%s/api/charts/wind?bis=%d&tage=%d&dark=0", w.BaseURL, time.Now().UnixMilli(), days)
		var ch struct {
			Data struct {
				Labels   []int64 `json:"labels"`
				Datasets []struct {
					Label string     `json:"label"`
					Data  []*float64 `json:"data"`
				} `json:"datasets"`
			} `json:"data"`
		}
		if err := w.fetchJSON(ctx, u, &ch); err != nil {
			return nil, err
		}
		series := map[string][]*float64{}
		for _, d := range ch.Data.Datasets {
			series[d.Label] = d.Data
		}
		at := func(label string, i int) *float64 {
			if s := series[label]; i < len(s) {
				return s[i]
			}
			return nil
		}
		out := make([]HistPoint, len(ch.Data.Labels))
		for i, t := range ch.Data.Labels {
			out[i] = HistPoint{T: t, HWind: at("øWind H", i), HGust: at("Bö Herrsching", i), HDir: at("Richt.H", i),
				UWind: at("øWind U", i), UGust: at("Bö Utting", i), UDir: at("Richt.U", i)}
		}
		return out, nil
	})
	if err != nil {
		return nil, false, err
	}
	return v.([]HistPoint), stale, nil
}

// ---------- Vorhersage (Open-Meteo, Raster über dem See) ----------

type GridPoint struct {
	Lat  float64   `json:"lat"`
	Lon  float64   `json:"lon"`
	Wind []float64 `json:"wind"` // kn
	Gust []float64 `json:"gust"`
	Dir  []float64 `json:"dir"` // Grad, woher der Wind kommt
}

type Forecast struct {
	Times  []string    `json:"times"` // lokale Zeit "2026-11-09T18:00"
	Points []GridPoint `json:"points"`
	Cols   int         `json:"cols"`
	Rows   int         `json:"rows"`
}

// Raster: Zeilen von Nord nach Süd, Spalten von West nach Ost.
var gridLats = []float64{48.08, 48.04, 48.00, 47.96, 47.92}
var gridLons = []float64{11.05, 11.09, 11.13, 11.17, 11.21}

func (w *Weather) Forecast(ctx context.Context) (*Forecast, bool, error) {
	v, stale, err := w.get("forecast", 30*time.Minute, func() (any, error) {
		var lats, lons []string
		for _, la := range gridLats {
			for _, lo := range gridLons {
				lats = append(lats, strconv.FormatFloat(la, 'f', 3, 64))
				lons = append(lons, strconv.FormatFloat(lo, 'f', 3, 64))
			}
		}
		u := "https://api.open-meteo.com/v1/forecast?latitude=" + strings.Join(lats, ",") + "&longitude=" + strings.Join(lons, ",") +
			"&hourly=wind_speed_10m,wind_direction_10m,wind_gusts_10m&wind_speed_unit=kn&forecast_days=2&timezone=Europe%2FBerlin"
		var res []struct {
			Hourly struct {
				Time []string  `json:"time"`
				Wind []float64 `json:"wind_speed_10m"`
				Dir  []float64 `json:"wind_direction_10m"`
				Gust []float64 `json:"wind_gusts_10m"`
			} `json:"hourly"`
		}
		if err := w.fetchJSON(ctx, u, &res); err != nil {
			return nil, err
		}
		if len(res) != len(lats) {
			return nil, fmt.Errorf("open-meteo: %d statt %d Punkte", len(res), len(lats))
		}
		f := &Forecast{Cols: len(gridLons), Rows: len(gridLats), Times: res[0].Hourly.Time}
		for i, r := range res {
			la, _ := strconv.ParseFloat(lats[i], 64)
			lo, _ := strconv.ParseFloat(lons[i], 64)
			f.Points = append(f.Points, GridPoint{Lat: la, Lon: lo, Wind: round1(r.Hourly.Wind), Gust: round1(r.Hourly.Gust), Dir: round1(r.Hourly.Dir)})
		}
		return f, nil
	})
	if err != nil {
		return nil, false, err
	}
	return v.(*Forecast), stale, nil
}

func round1(a []float64) []float64 {
	out := make([]float64, len(a))
	for i, v := range a {
		out[i] = math.Round(v*10) / 10
	}
	return out
}

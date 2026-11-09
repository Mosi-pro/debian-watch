package sail

import (
	"math"
	"sort"
	"strings"
)

type Named struct {
	Name  string  `json:"name"`
	Count int     `json:"count"`
	NM    float64 `json:"nm"`
}

type Stats struct {
	Trips      int         `json:"trips"`
	Days       int         `json:"days"`
	NM         float64     `json:"nm"`
	Hours      float64     `json:"hours"`
	AvgSpeed   float64     `json:"avg_speed"` // kn, nm/h
	WindAvg    float64     `json:"wind_avg"`
	WindMax    float64     `json:"wind_max"`
	Longest    *Entry      `json:"longest,omitempty"`
	Fastest    *Entry      `json:"windiest,omitempty"`
	First      string      `json:"first"`
	Last       string      `json:"last"`
	ByMonth    [12]float64 `json:"by_month_nm"`
	TripsMonth [12]int     `json:"by_month_trips"`
	ByType     []Named     `json:"by_type"`
	Crew       []Named     `json:"crew"`
	Boats      []Named     `json:"boats"`
}

func round(v float64, d int) float64 {
	p := math.Pow(10, float64(d))
	return math.Round(v*p) / p
}

// Compute berechnet die Saison-Kennzahlen aus Einträgen (reine Funktion).
func Compute(es []Entry) Stats {
	var st Stats
	st.Trips = len(es)
	days := map[string]bool{}
	types, crew, boats := map[string]*Named{}, map[string]*Named{}, map[string]*Named{}
	var windSum float64
	var windN int
	add := func(m map[string]*Named, k string, nm float64) {
		if k == "" {
			return
		}
		n := m[k]
		if n == nil {
			n = &Named{Name: k}
			m[k] = n
		}
		n.Count++
		n.NM += nm
	}
	for i := range es {
		e := es[i]
		st.NM += e.Distance
		st.Hours += e.Hours
		days[e.Date] = true
		if m := int(e.Date[5]-'0')*10 + int(e.Date[6]-'0') - 1; m >= 0 && m < 12 {
			st.ByMonth[m] += e.Distance
			st.TripsMonth[m]++
		}
		if e.WindAvg > 0 {
			windSum += e.WindAvg
			windN++
		}
		if e.WindMax > st.WindMax {
			st.WindMax = e.WindMax
			c := e
			st.Fastest = &c
		}
		if st.Longest == nil || e.Distance > st.Longest.Distance {
			c := e
			st.Longest = &c
		}
		if st.First == "" || e.Date < st.First {
			st.First = e.Date
		}
		if e.Date > st.Last {
			st.Last = e.Date
		}
		add(types, e.Type, e.Distance)
		add(boats, strings.TrimSpace(e.Boat), e.Distance)
		for _, c := range strings.Split(e.Crew, ",") {
			add(crew, strings.TrimSpace(c), e.Distance)
		}
	}
	st.Days = len(days)
	if st.Hours > 0 {
		st.AvgSpeed = round(st.NM/st.Hours, 1)
	}
	if windN > 0 {
		st.WindAvg = round(windSum/float64(windN), 1)
	}
	st.NM, st.Hours = round(st.NM, 1), round(st.Hours, 1)
	for i := range st.ByMonth {
		st.ByMonth[i] = round(st.ByMonth[i], 1)
	}
	flat := func(m map[string]*Named) []Named {
		out := make([]Named, 0, len(m))
		for _, v := range m {
			v.NM = round(v.NM, 1)
			out = append(out, *v)
		}
		sort.Slice(out, func(i, j int) bool {
			if out[i].Count != out[j].Count {
				return out[i].Count > out[j].Count
			}
			return out[i].Name < out[j].Name
		})
		return out
	}
	st.ByType, st.Crew, st.Boats = flat(types), flat(crew), flat(boats)
	return st
}

// Haversine in Seemeilen.
func RouteNM(r [][2]float64) float64 {
	const R = 3440.065
	var d float64
	for i := 1; i < len(r); i++ {
		la1, la2 := r[i-1][0]*math.Pi/180, r[i][0]*math.Pi/180
		dla, dlo := la2-la1, (r[i][1]-r[i-1][1])*math.Pi/180
		a := math.Sin(dla/2)*math.Sin(dla/2) + math.Cos(la1)*math.Cos(la2)*math.Sin(dlo/2)*math.Sin(dlo/2)
		d += 2 * R * math.Asin(math.Sqrt(a))
	}
	return d
}

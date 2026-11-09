// Package metrics samples system load with gopsutil and keeps a ring buffer.
package metrics

import (
	"context"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/shirou/gopsutil/v4/cpu"
	"github.com/shirou/gopsutil/v4/disk"
	"github.com/shirou/gopsutil/v4/host"
	"github.com/shirou/gopsutil/v4/load"
	"github.com/shirou/gopsutil/v4/mem"
	"github.com/shirou/gopsutil/v4/net"
	"github.com/shirou/gopsutil/v4/process"
	"github.com/shirou/gopsutil/v4/sensors"
)

type Proc struct {
	PID  int32   `json:"pid"`
	Name string  `json:"name"`
	CPU  float64 `json:"cpu"`
	Mem  float32 `json:"mem"`
}

type Sample struct {
	T         int64   `json:"t"` // unix ms
	CPU       float64 `json:"cpu"`
	MemUsed   uint64  `json:"mem_used"`
	MemTotal  uint64  `json:"mem_total"`
	SwapUsed  uint64  `json:"swap_used"`
	SwapTotal uint64  `json:"swap_total"`
	DiskUsed  uint64  `json:"disk_used"`
	DiskTotal uint64  `json:"disk_total"`
	NetRx     float64 `json:"net_rx"` // bytes/s
	NetTx     float64 `json:"net_tx"`
	Temp      float64 `json:"temp"` // 0 = unavailable
	Load1     float64 `json:"load1"`
	Load5     float64 `json:"load5"`
	Load15    float64 `json:"load15"`
	Uptime    uint64  `json:"uptime"`
	Procs     []Proc  `json:"procs,omitempty"`
}

type Info struct {
	Hostname string `json:"hostname"`
	OS       string `json:"os"`
	Kernel   string `json:"kernel"`
	CPUModel string `json:"cpu_model"`
	Cores    int    `json:"cores"`
}

const Capacity = 1800 // 1 hour at 2 s

type Collector struct {
	mu       sync.RWMutex
	ring     []Sample
	last     Sample
	subs     map[chan Sample]struct{}
	prevRx   uint64
	prevTx   uint64
	prevT    time.Time
	procs    []Proc
	procT    time.Time
	Interval time.Duration
}

func New() *Collector {
	return &Collector{subs: map[chan Sample]struct{}{}, Interval: 2 * time.Second}
}

func GetInfo() Info {
	i := Info{}
	if h, err := host.Info(); err == nil {
		i.Hostname, i.OS, i.Kernel = h.Hostname, h.Platform+" "+h.PlatformVersion, h.KernelVersion
	}
	if c, err := cpu.Info(); err == nil && len(c) > 0 {
		i.CPUModel = c[0].ModelName
	}
	i.Cores, _ = cpu.Counts(true)
	return i
}

func (c *Collector) Run(ctx context.Context) {
	cpu.Percent(0, false) // prime
	t := time.NewTicker(c.Interval)
	defer t.Stop()
	for {
		s := c.sample()
		c.mu.Lock()
		c.last = s
		c.ring = append(c.ring, s)
		if len(c.ring) > Capacity {
			c.ring = c.ring[len(c.ring)-Capacity:]
		}
		for ch := range c.subs {
			select {
			case ch <- s:
			default: // slow subscriber: drop
			}
		}
		c.mu.Unlock()
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}

func (c *Collector) sample() Sample {
	s := Sample{T: time.Now().UnixMilli()}
	if p, err := cpu.Percent(0, false); err == nil && len(p) > 0 {
		s.CPU = p[0]
	}
	if m, err := mem.VirtualMemory(); err == nil {
		s.MemUsed, s.MemTotal = m.Total-m.Available, m.Total
	}
	if m, err := mem.SwapMemory(); err == nil {
		s.SwapUsed, s.SwapTotal = m.Used, m.Total
	}
	if d, err := disk.Usage("/"); err == nil {
		s.DiskUsed, s.DiskTotal = d.Used, d.Total
	}
	if io, err := net.IOCounters(false); err == nil && len(io) > 0 {
		now := time.Now()
		if !c.prevT.IsZero() {
			dt := now.Sub(c.prevT).Seconds()
			if dt > 0 && io[0].BytesRecv >= c.prevRx && io[0].BytesSent >= c.prevTx {
				s.NetRx = float64(io[0].BytesRecv-c.prevRx) / dt
				s.NetTx = float64(io[0].BytesSent-c.prevTx) / dt
			}
		}
		c.prevRx, c.prevTx, c.prevT = io[0].BytesRecv, io[0].BytesSent, now
	}
	s.Temp = temperature()
	if l, err := load.Avg(); err == nil {
		s.Load1, s.Load5, s.Load15 = l.Load1, l.Load5, l.Load15
	}
	s.Uptime, _ = host.Uptime()
	if time.Since(c.procT) > 5*time.Second {
		c.procs = topProcs(8)
		c.procT = time.Now()
	}
	s.Procs = c.procs
	return s
}

func temperature() float64 {
	ts, err := sensors.SensorsTemperatures()
	if err != nil && len(ts) == 0 {
		return 0
	}
	best := 0.0
	for _, t := range ts {
		k := strings.ToLower(t.SensorKey)
		if (strings.Contains(k, "core") || strings.Contains(k, "cpu") || strings.Contains(k, "package") ||
			strings.Contains(k, "thermal") || strings.Contains(k, "k10temp")) && t.Temperature > best && t.Temperature < 150 {
			best = t.Temperature
		}
	}
	if best == 0 {
		for _, t := range ts {
			if t.Temperature > best && t.Temperature < 150 {
				best = t.Temperature
			}
		}
	}
	return best
}

func topProcs(n int) []Proc {
	ps, err := process.Processes()
	if err != nil {
		return nil
	}
	var out []Proc
	for _, p := range ps {
		cp, err := p.CPUPercent() // lifetime average; cheap and stable
		if err != nil {
			continue
		}
		name, _ := p.Name()
		if r := []rune(name); len(r) > 24 {
			name = string(r[:24]) + "…"
		}
		mp, _ := p.MemoryPercent()
		out = append(out, Proc{PID: p.Pid, Name: name, CPU: cp, Mem: mp})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].CPU == out[j].CPU {
			return out[i].Mem > out[j].Mem
		}
		return out[i].CPU > out[j].CPU
	})
	if len(out) > n {
		out = out[:n]
	}
	return out
}

func (c *Collector) Last() Sample {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.last
}

// History returns samples without the process list (keeps payload small).
func (c *Collector) History() []Sample {
	c.mu.RLock()
	defer c.mu.RUnlock()
	out := make([]Sample, len(c.ring))
	for i, s := range c.ring {
		s.Procs = nil
		out[i] = s
	}
	return out
}

func (c *Collector) Subscribe() (chan Sample, func()) {
	ch := make(chan Sample, 4)
	c.mu.Lock()
	c.subs[ch] = struct{}{}
	c.mu.Unlock()
	return ch, func() {
		c.mu.Lock()
		delete(c.subs, ch)
		c.mu.Unlock()
	}
}

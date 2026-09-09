import { Component, OnDestroy, OnInit } from '@angular/core';

import { DataService } from '../../core/data.service';
import { Item } from '../../core/models';

interface Ping {
  itemId: string;
  name: string;
  status: string;
  inYard: boolean;
  lastSeen: string;
  battery: number;
  signal: number;
}

interface FeedEntry {
  id: number;
  at: string;
  msg: string;
  kind: 'breach' | 'ping';
}

const YARD_RADIUS_M = 300;

@Component({
  selector: 'ims-telemetry',
  standalone: true,
  templateUrl: './telemetry.component.html',
  styleUrl: './telemetry.component.scss',
})
export class TelemetryComponent implements OnInit, OnDestroy {
  radius = YARD_RADIUS_M;
  pings: Ping[] = [];
  feed: FeedEntry[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private seq = 0;

  constructor(readonly data: DataService) {}

  ngOnInit(): void {
    this.refreshPings();
    this.timer = setInterval(() => this.tick(), 2500);
  }

  ngOnDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Rebuild the live board from catalog items + their custody status. */
  private refreshPings(): void {
    const items: Item[] = this.data.listItems('serialized');
    const now = new Date();
    this.pings = items.map((it) => {
      const inYard = it.status === 'Available' || it.status === 'In Shop';
      return {
        itemId: it.id,
        name: it.name,
        status: it.status,
        inYard,
        lastSeen: now.toLocaleTimeString(),
        battery: 100 - ((Math.abs(it.id.length * 7) + it.name.length) % 31),
        signal: 60 + ((it.id.charCodeAt(1) + it.name.length * 3) % 40),
      };
    });
  }

  private tick(): void {
    const now = new Date();
    this.pings.forEach((p) => {
      p.lastSeen = now.toLocaleTimeString();
      p.signal = Math.max(20, Math.min(100, p.signal + (Math.random() > 0.5 ? 1 : -1) * 5));
      p.battery = Math.max(5, p.battery - (Math.random() > 0.7 ? 1 : 0));
      if (p.inYard) return;
      if (Math.random() > 0.85) {
        this.push('breach', `Asset ${p.itemId} pinged ${Math.round(Math.random() * 180)}m outside ${this.radius}m geofence`);
      }
    });
    this.push('ping', `${this.pings.filter((p) => !p.inYard).length} asset(s) on site · ${this.pings.length} tracked`);
  }

  private push(kind: FeedEntry['kind'], msg: string): void {
    this.seq++;
    this.feed.unshift({ id: this.seq, at: new Date().toLocaleTimeString(), kind, msg });
    if (this.feed.length > 20) this.feed.length = 20;
  }

  outCount(): number {
    return this.pings.filter((p) => !p.inYard).length;
  }

  breachCount(): number {
    return this.feed.filter((f) => f.kind === 'breach').length;
  }
}

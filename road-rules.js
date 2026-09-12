import {speedLimit} from './junctions.js';
// What the town expects of the person at the wheel. Until now only the auto-driver knew Winthrop had rules:
// auto-cruise.js reads Junctions.lookAhead every frame and stops for signs and red lights, while the human
// driver ran on driving-physics.js alone, which knew about curbs and nothing else. You could take every stop
// sign in town at forty and the game had no opinion. This module gives the human driver the same reading of
// the same junction data — one rule set, as junctions.js puts it, so every vehicle reads the same corner the
// same way — and reports what it sees. It does not touch the controls: braking the car for someone who is
// driving it themselves feels like a fault, not a rule. It watches, it calls it, and it keeps the count.
//
// Everything it needs already exists on the DrivingSystem: cruise.junctions, cruise.stops, cruise.lights are
// wired in app.js the moment the street furniture loads. Before that they are undefined and this stays quiet.

const STOPPED = 0.5;       // m/s. Slower than this at a sign counts as a stop; a roll-through does not.
const ZONE = 3.5;          // m before the line where a stop may be made and still count.
const SPEED_GRACE = 1.25;  // 25% over the posted limit before anyone says anything.
const SPEED_HOLD = 1.5;    // seconds over the limit before it becomes a violation, so a dip downhill is free.
const WRONG_HOLD = 1.0;    // seconds facing the wrong way before it counts, so a three-point turn is free.

export class RoadRules {
  constructor(){ this.reset(); }

  reset(){
    this.control = null;      // the corner being approached: {kind,dist,line,light}
    this.call = '';           // one short line for the HUD, '' when there is nothing to say
    this.counts = { stop:0, signal:0, speed:0, wrongWay:0 };
    this.events = [];         // newest first, for the end-of-run readout
    this.armed = null;        // the corner we are currently accountable to
    this.satisfied = false;   // did we do what it asked before the line
    this.overTime = 0;
    this.wrongTime = 0;
    this.speedArmed = true;
    this.limit = 0;
  }

  // The straight-ahead continuation of an edge. The auto-driver chooses a route; a person at the wheel has not
  // told us one, so look-ahead assumes they carry on, which is true right up until they indicate otherwise —
  // and if they turn instead, the corner they were accountable to is simply dropped on the next frame.
  chooser(junctions){
    return edge => {
      const arms = junctions.arms(edge);
      let best = null;
      for(const a of arms){
        if(a.side === 'back' || !a.outbound) continue;
        const dot = (a.dx*edge.dx + a.dz*edge.dz) / (edge.length || 1);
        if(!best || dot > best.dot) best = { dot, seg:a.seg };
      }
      if(!best || best.dot < 0.8) return null;
      const s = best.seg, atA = Math.hypot(s.a[0]-edge.b[0], s.a[1]-edge.b[1]) < 1.5;
      const a = atA ? s.a : s.b, b = atA ? s.b : s.a;
      return { ...s, reversed:!atA, a, b, dx:b[0]-a[0], dz:b[1]-a[1] };
    };
  }

  note(kind, text){
    this.counts[kind]++;
    this.events.unshift({ kind, text, at:Date.now() });
    if(this.events.length > 12) this.events.length = 12;
    this.call = text;
    this.callTime = 2.2;
  }

  update(dt, state, cruise){
    if(this.callTime > 0 && (this.callTime -= dt) <= 0) this.call = '';
    const road = state.road;
    if(!road || !cruise || !cruise.junctions){ this.control = null; return; }

    // --- posted limit -------------------------------------------------------------------------------------
    this.limit = speedLimit(road);
    if(state.speed > this.limit * SPEED_GRACE){
      this.overTime += dt;
      if(this.speedArmed && this.overTime >= SPEED_HOLD){
        this.speedArmed = false;
        this.note('speed', Math.round(this.limit / 0.44704) + ' mph here');
      }
    } else {
      this.overTime = 0;
      if(state.speed <= this.limit) this.speedArmed = true;
    }

    // --- wrong way ----------------------------------------------------------------------------------------
    // driving-physics.js has computed this every frame since the day it was written and nothing ever read it.
    if(state.wrongWay){
      this.wrongTime += dt;
      if(this.wrongTime >= WRONG_HOLD && this.wrongArmed !== false){
        this.wrongArmed = false;
        this.note('wrongWay', 'Wrong way');
      }
    } else {
      this.wrongTime = 0;
      this.wrongArmed = true;
    }

    // --- the next controlled corner ------------------------------------------------------------------------
    const t = Math.max(0, Math.min(1,
      ((state.x - road.a[0])*road.dx + (state.z - road.a[1])*road.dz) / (road.length**2 || 1)));
    const ahead = cruise.junctions.lookAhead(
      road, t, this.chooser(cruise.junctions), cruise.lights, cruise.stops || [], 60);

    if(!ahead){ this.control = null; this.armed = null; return; }

    // Distance from the car to the stop line, not to the corner: the line is what you are asked to hold at.
    const toLine = ahead.dist - ahead.line;
    let light = null;
    if(ahead.kind === 'signal' && cruise.lights){
      const e = ahead.edge;
      const l = cruise.lights.lightAhead(e.b[0], e.b[1], e.dx/e.length, e.dz/e.length, undefined, 4);
      light = l ? l.state : 'green';
    }
    this.control = { kind:ahead.kind, dist:ahead.dist, toLine, line:ahead.line, light };

    // Arm on approach. The identity of a corner is the edge it sits at, so turning off simply re-arms elsewhere.
    const id = ahead.edge.a[0] + ',' + ahead.edge.a[1] + ',' + ahead.edge.b[0] + ',' + ahead.edge.b[1];
    if(!this.armed || this.armed.id !== id){
      this.armed = { id, kind:ahead.kind, judged:false };
      this.satisfied = false;
    }

    // A stop sign is satisfied by actually stopping inside the zone before the line. A light is satisfied by
    // not being red at the moment you reach it — yellow is a judgement call and the town lets you have it.
    if(ahead.kind === 'stop'){
      if(toLine <= ZONE && toLine > -1 && state.speed < STOPPED) this.satisfied = true;
    } else if(light && light !== 'red'){
      this.satisfied = true;
    } else if(light === 'red'){
      this.satisfied = false;
    }

    // Judge once, when the nose crosses the line and the car is still moving.
    if(!this.armed.judged && toLine < -0.5 && state.speed > STOPPED){
      this.armed.judged = true;
      if(!this.satisfied) this.note(ahead.kind === 'stop' ? 'stop' : 'signal',
        ahead.kind === 'stop' ? 'Ran the stop sign' : 'Ran a red light');
    }
  }

  // What the HUD should be showing right now: the call if there is one, otherwise the corner being approached.
  hint(){
    if(this.call) return { text:this.call, bad:true };
    const c = this.control;
    if(!c || c.toLine > 34) return null;
    if(c.kind === 'stop') return { text:'Stop ahead', bad:false };
    if(c.light === 'red') return { text:'Red light', bad:false };
    if(c.light === 'yellow') return { text:'Light changing', bad:false };
    return null;
  }

  get total(){ return this.counts.stop + this.counts.signal + this.counts.speed + this.counts.wrongWay; }
}

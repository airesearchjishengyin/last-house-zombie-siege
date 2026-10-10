(() => {
  const canvas = document.querySelector('#arena');
  const ctx = canvas.getContext('2d');
  const $ = (s) => document.querySelector(s);
  const W = 1120, H = 690;
  const field = { x: 98, y: 46, w: 928, h: 592 };
  const MAPS = {
    ridge: { title: '北岭避难所', subtitle: '山脊工事 · 双侧通道', core: { x: 390, y: 245, w: 340, h: 200 }, obstacles: [{ x: 220, y: 128, w: 84, h: 54 }, { x: 810, y: 132, w: 92, h: 58 }, { x: 226, y: 505, w: 88, h: 64 }, { x: 810, y: 500, w: 92, h: 60 }, { x: 510, y: 100, w: 96, h: 38 }] },
    crossroads: { title: '十字路口', subtitle: '街区废墟 · 多条迂回路线', core: { x: 423, y: 250, w: 274, h: 188 }, obstacles: [{ x: 210, y: 155, w: 126, h: 92 }, { x: 785, y: 150, w: 124, h: 96 }, { x: 204, y: 430, w: 132, h: 100 }, { x: 790, y: 435, w: 118, h: 94 }, { x: 472, y: 112, w: 176, h: 42 }, { x: 468, y: 534, w: 184, h: 46 }] },
    foundry: { title: '废弃工厂', subtitle: '工业区 · 管线与仓库掩体', core: { x: 424, y: 263, w: 272, h: 170 }, obstacles: [{ x: 180, y: 112, w: 178, h: 86 }, { x: 760, y: 112, w: 180, h: 86 }, { x: 176, y: 475, w: 184, h: 92 }, { x: 758, y: 478, w: 184, h: 88 }, { x: 425, y: 124, w: 64, h: 100 }, { x: 632, y: 450, w: 65, h: 96 }, { x: 580, y: 108, w: 76, h: 66 }] },
  };
  Object.assign(MAPS, globalThis.NEST_MAPS || {});
  let mapId = 'labyrinth', customObstacles = [], house = { ...MAPS.ridge.core }, door = { x: 0, y: 0, w: 72, h: 9 };
  const MOTHER_MAX_HP = 900;
  const AMMO_CAPACITY = [150, 72, 20, 24];
  let ammoMode = 'infinite', supplyVisits = 0;
  let mother = null, motherFound = false, explorationClock = 0, exploredRooms = new Set(), seenCells = new Set();
  const FOG_CELL = 28;
  const layout = () => mapId === 'custom' ? {} : MAPS[mapId];
  const searchSites = () => layout().searchSites || [{x:house.x+60,y:house.y+house.h/2},{x:house.x+house.w-60,y:house.y+house.h/2}];
  const supplyPoints = () => layout().supplies || [{x:155,y:390},{x:house.x+house.w+42,y:house.y+house.h+20}];
  let mission = 'protect', editingMap = false, missionCoreHp = MOTHER_MAX_HP, battleVersion = 0;
  const navigationGraphs = new Map();
  const updateDoor = () => { door = { x: house.x + house.w / 2 - 36, y: house.y + house.h - 3, w: 72, h: 9 }; };
  function activeObstacles() {
    const walls = mapId === 'custom' ? customObstacles : MAPS[mapId].obstacles;
    if (mission === 'protect') return [house, ...walls];
    if (layout().nest) return walls;
    // Legacy and custom maps become walkable shells during infiltration.
    return [...walls, {x:house.x,y:house.y,w:house.w,h:14}, {x:house.x,y:house.y+house.h-14,w:house.w,h:14}, {x:house.x+house.w-14,y:house.y,w:14,h:house.h}, {x:house.x,y:house.y,w:14,h:house.h/2-35}, {x:house.x,y:house.y+house.h/2+35,w:14,h:house.h/2-35}];
  }
  const ballisticObstacles = () => activeObstacles().filter(r => !r.movementOnly);
  const sightBlocked = (a,b,padding=0) => ballisticObstacles().some(r => segmentHitsRect(a,b,r,padding) !== null);

  updateDoor();

  function applyMap(nextId) {
    mapId = nextId;
    if (mapId === 'custom') {
      house = { x: 412, y: 248, w: 296, h: 190 };
      try { customObstacles = validateCustomMap(JSON.parse(localStorage.getItem('last-house-custom-map') || '[]')); } catch (_) { customObstacles = []; }
    } else {
      house = { ...MAPS[mapId].core };
      customObstacles = [];
    }
    updateDoor();
    configureMission();
    $('#map-title').textContent = mapId === 'custom' ? '自定义地图' : MAPS[mapId].title;
    $('#map-subtitle').textContent = mapId === 'custom' ? '自定义掩体 · 自动保存' : MAPS[mapId].subtitle;
    navigationGraphs.clear();
    zombies.length = 0; bullets.length = 0; particles.length = 0;
    gate = 100; missionCoreHp = MOTHER_MAX_HP; wave = 0; waveTime = 0; spawnClock = 0; nextWaveIn = 0;
    $('#wave-display').textContent = '01'; $('#wave-progress').style.width = '0%';
    updateHud(); draw();
  }

  function pointBlocked(x, y, padding = 0) {
    return activeObstacles().some(r => x > r.x - padding && x < r.x + r.w + padding && y > r.y - padding && y < r.y + r.h + padding);
  }

  function segmentHitsRect(a, b, rect, padding = 0) {
    const left = rect.x - padding, right = rect.x + rect.w + padding;
    const top = rect.y - padding, bottom = rect.y + rect.h + padding;
    let tMin = 0, tMax = 1;
    const dx = b.x - a.x, dy = b.y - a.y;
    for (const [p, q] of [[-dx, a.x - left], [dx, right - a.x], [-dy, a.y - top], [dy, bottom - a.y]]) {
      if (Math.abs(p) < 1e-8) { if (q < 0) return null; continue; }
      const t = q / p;
      if (p < 0) { if (t > tMax) return null; tMin = Math.max(tMin, t); }
      else { if (t < tMin) return null; tMax = Math.min(tMax, t); }
    }
    return tMin >= 0 && tMin <= 1 ? tMin : null;
  }

  function lineBlocked(a, b, padding = 2, ignore = null) {
    return activeObstacles().some(r => r !== ignore && segmentHitsRect(a, b, r, padding) !== null);
  }

  function insideField(p, radius = 10) {
    return p.x >= field.x + radius && p.x <= field.x + field.w - radius && p.y >= field.y + radius && p.y <= field.y + field.h - radius;
  }

  function safePoint(point, radius = 10) {
    const base = { x: clamp(point.x, field.x + radius, field.x + field.w - radius), y: clamp(point.y, field.y + radius, field.y + field.h - radius) };
    if (!pointBlocked(base.x, base.y, radius)) return base;
    for (let r = 16; r < 1000; r += 16) for (let i = 0; i < 32; i++) {
      const p = { x: base.x + Math.cos(i * Math.PI / 16) * r, y: base.y + Math.sin(i * Math.PI / 16) * r };
      if (insideField(p, radius) && !pointBlocked(p.x, p.y, radius)) return p;
    }
    return null;
  }

  function findPath(start, goal, padding = 10) {
    padding = Math.ceil(padding);
    if (!insideField(goal, padding) || pointBlocked(goal.x, goal.y, padding)) return [];
    if (!lineBlocked(start, goal, padding)) return [{ ...goal }];
    let graph = navigationGraphs.get(padding);
    if (!graph) {
      const corners = [];
      activeObstacles().forEach(r => {
        const gap = padding + 3;
        corners.push({ x: r.x - gap, y: r.y - gap }, { x: r.x + r.w + gap, y: r.y - gap }, { x: r.x - gap, y: r.y + r.h + gap }, { x: r.x + r.w + gap, y: r.y + r.h + gap });
      });
      const nodes = corners.filter(p => insideField(p, padding) && !pointBlocked(p.x, p.y, padding));
      const edges = nodes.map(() => []);
      for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
        if (!lineBlocked(nodes[i], nodes[j], padding)) {
          const d = distance(nodes[i], nodes[j]);
          edges[i].push([j, d]); edges[j].push([i, d]);
        }
      }
      graph = { nodes, edges }; navigationGraphs.set(padding, graph);
    }
    const nodes = [start, goal, ...graph.nodes];
    const edges = [[], [], ...graph.edges.map(es => es.map(([j, d]) => [j + 2, d]))];
    for (let k = 0; k < 2; k++) for (let j = 2; j < nodes.length; j++) {
      if (!lineBlocked(nodes[k], nodes[j], padding)) {
        const d = distance(nodes[k], nodes[j]); edges[k].push([j, d]); edges[j].push([k, d]);
      }
    }
    const costs = Array(nodes.length).fill(Infinity), prev = Array(nodes.length).fill(-1), used = Array(nodes.length).fill(false);
    costs[0] = 0;
    for (let n = 0; n < nodes.length; n++) {
      let at = -1;
      for (let i = 0; i < nodes.length; i++) if (!used[i] && (at < 0 || costs[i] + distance(nodes[i], goal) < costs[at] + distance(nodes[at], goal))) at = i;
      if (at < 0 || !Number.isFinite(costs[at])) break;
      if (at === 1) break;
      used[at] = true;
      for (const [j, d] of edges[at]) {
        if (costs[at] + d < costs[j]) { costs[j] = costs[at] + d; prev[j] = at; }
      }
    }
    if (!Number.isFinite(costs[1])) return [];
    const path = [];
    for (let at = 1; at !== 0 && at >= 0; at = prev[at]) path.unshift({ ...nodes[at] });
    return path;
  }

  function moveAlongPath(unit, goal, moveSpeed, dt, radius = 8) {
    if (!goal) return;
    unit.routeTimer = (unit.routeTimer ?? 0) - dt;
    if (!unit.path || !unit.routeGoal || distance(unit.routeGoal, goal) > 18 || unit.routeTimer <= 0) {
      unit.path = findPath(unit, goal, radius);
      unit.pathIndex = 0; unit.routeGoal = { ...goal }; unit.routeTimer = rand(.8, 1.4);
    }
    let budget = moveSpeed * dt;
    while (budget > 0 && unit.pathIndex < unit.path.length) {
      const waypoint = unit.path[unit.pathIndex], d = distance(unit, waypoint);
      if (d < .01) { unit.pathIndex++; continue; }
      const step = Math.min(d, budget);
      const next = { x: unit.x + (waypoint.x - unit.x) / d * step, y: unit.y + (waypoint.y - unit.y) / d * step };
      // Sweep the entire movement, including corners, even when the frame is slow.
      if (lineBlocked(unit, next, radius) || !insideField(next, radius)) { unit.path = null; return; }
      unit.x = next.x; unit.y = next.y; budget -= step;
      if (step >= d) unit.pathIndex++;
    }
  }

  function editCustomMap(x, y) {
    if (mapId !== 'custom' || !editingMap) return;
    const size = 16, sx = Math.round(x / size) * size, sy = Math.round(y / size) * size;
    const hit = customObstacles.findIndex(r => sx >= r.x - 8 && sx <= r.x + r.w + 8 && sy >= r.y - 8 && sy <= r.y + r.h + 8);
    if (hit >= 0) customObstacles.splice(hit, 1);
    else {
      const added = { x: sx - 26, y: sy - 19, w: 52, h: 38 };
      if (pointBlocked(sx, sy, 40)) { toast('此处距建筑或掩体太近，请保留通道。'); return; }
      try { customObstacles = validateCustomMap([...customObstacles, added]); }
      catch (error) { toast(error.message); return; }
    }
    navigationGraphs.clear();
    configureMission();
    try { localStorage.setItem('last-house-custom-map', JSON.stringify(customObstacles)); } catch (_) { toast('浏览器无法持久保存地图，请导出备份。'); }
    seedSurvivors();
    survivors.forEach(s => { s.path = null; s.replan = 0; });
    draw();
  }

  function validateCustomMap(data) {
    const rectangles = Array.isArray(data) ? data : data?.obstacles;
    if (!Array.isArray(rectangles) || rectangles.length > 32) throw new Error('地图最多包含 32 个矩形掩体。');
    return rectangles.map(r => {
      if (!r || !['x', 'y', 'w', 'h'].every(k => typeof r[k] === 'number' && Number.isFinite(r[k]))) throw new Error('掩体需要有效的 x、y、w、h。');
      if (r.w < 16 || r.h < 16 || r.w > 240 || r.h > 240 || r.x < field.x + 24 || r.y < field.y + 24 || r.x + r.w > field.x + field.w - 24 || r.y + r.h > field.y + field.h - 24) throw new Error('掩体尺寸应为 16–240，且不能超出战场安全边界。');
      if (r.x < house.x + house.w + 50 && r.x + r.w > house.x - 50 && r.y < house.y + house.h + 50 && r.y + r.h > house.y - 50) throw new Error('请在任务核心周围保留 50 的通道。');
      return { x: r.x, y: r.y, w: r.w, h: r.h };
    });
  }

  function chooseCorePosition(s, type) {
    if(!motherFound||!mother)return null;
    const options=[];
    for(const radius of [Math.min(type.ideal,110),60,30])for(let i=0;i<16;i++) {
      const p={x:mother.x+Math.cos(i*Math.PI/8)*radius,y:mother.y+Math.sin(i*Math.PI/8)*radius};
      if(!insideField(p,12)||pointBlocked(p.x,p.y,12)||sightBlocked(p,mother))continue;
      options.push({p,cost:distance(s,p)+zombies.filter(z=>z.alive&&distance(z,p)<60).length*60});
    }
    options.sort((a,b)=>a.cost-b.cost);
    for(const {p} of options)if(findPath(s,p,8).length)return p;
    return null;
  }

  function configureMission() {
    navigationGraphs.clear();
    motherFound=false; exploredRooms=new Set(); seenCells=new Set(); explorationClock=0; supplyVisits=0;
    const candidates=layout().motherCandidates || [{x:house.x+house.w-42,y:house.y+45}];
    const location=candidates[Math.floor(Math.random()*candidates.length)];
    mother=mission==='destroy'?{...location,r:9}:null;
  }

  function updateExploration(dt) {
    if(mission!=='destroy')return;
    explorationClock-=dt;
    if(explorationClock>0)return;
    explorationClock=.28;
    const living=survivors.filter(s=>s.alive);
    if(!motherFound && living.some(s=>distance(s,mother)<155&&!sightBlocked(s,mother))) {
      motherFound=true;
      survivors.forEach(s=>{s.replan=0;});
      addLog('侦察发现母体：小型巢核已标记，转入消灭阶段。','alert');
      if(live){lastDecisionAt=-20;scheduleDecision(true);}
    }
    searchSites().forEach((p,i)=>{
      if(living.some(s=>distance(s,p)<55&&!sightBlocked(s,p)))exploredRooms.add(i);
    });
    for(const s of living) {
      const cx=Math.floor((s.x-field.x)/FOG_CELL),cy=Math.floor((s.y-field.y)/FOG_CELL);
      for(let dx=-6;dx<=6;dx++)for(let dy=-6;dy<=6;dy++){
        const x=cx+dx,y=cy+dy,p={x:field.x+(x+.5)*FOG_CELL,y:field.y+(y+.5)*FOG_CELL};
        if(distance(s,p)<165&&!sightBlocked(s,p))seenCells.add(`${x},${y}`);
      }
    }
  }

  function chooseSearchGoal(s) {
    const candidates=searchSites().map((p,i)=>({p,i})).filter(v=>!exploredRooms.has(v.i));
    if(!candidates.length) {
      // Search the corners of rooms as well; do not disclose the mother location to navigation.
      const corners=(layout().rooms||[]).flatMap(r=>[{x:r.x+25,y:r.y+25},{x:r.x+r.w-25,y:r.y+r.h-25}]);
      candidates.push(...corners.map((p,i)=>({p,i})));
    }
    candidates.sort((a,b)=>distance(s,a.p)-distance(s,b.p));
    for(const {p} of candidates){
      const route=findPath(s,p,8);
      if(route.length)return {...p};
    }
    return {x:s.homeX,y:s.homeY};
  }

  function handleSupply(s,dt) {
    if(ammoMode!=='finite'){s.resupplying=false;s.supplyTimer=0;return null;}
    if(!s.resupplying && s.ammo<=AMMO_CAPACITY[s.type]*.20){s.resupplying=true;s.supplyGoal=null;s.path=null;}
    if(!s.resupplying)return null;
    if(!s.supplyGoal){
      let cost=Infinity;
      for(const point of supplyPoints()){
        const p=safePoint(point,10),route=p&&findPath(s,p,8);
        if(!route?.length)continue;
        let last=s,length=0;
        for(const next of route){length+=distance(last,next);last=next;}
        length+=zombies.reduce((n,z)=>n+(z.alive&&distance(z,p)<65?85:0),0);
        if(length<cost){cost=length;s.supplyGoal=p;}
      }
    }
    const goal=s.supplyGoal;
    if(!goal)return {x:s.x,y:s.y};
    if(distance(s,goal)<18){
      s.supplyTimer+=dt;
      if(s.supplyTimer>=2){
        s.ammo=AMMO_CAPACITY[s.type];s.resupplying=false;s.supplyTimer=0;s.supplyGoal=null;s.replan=0;s.path=null;supplyVisits++;
        addLog(`${TYPES[s.type].name}完成补给，返回任务路线。`,'safe');
        return null;
      }
    }else s.supplyTimer=0;
    return goal;
  }

  function segmentHitsCircle(a, b, center, radius) {
    const dx = b.x - a.x, dy = b.y - a.y, ox = a.x - center.x, oy = a.y - center.y;
    const c = ox * ox + oy * oy - radius * radius;
    if (c <= 0) return 0;
    const square = dx * dx + dy * dy;
    if (square < 1e-8) return null;
    const linear = ox * dx + oy * dy, discriminant = linear * linear - square * c;
    if (discriminant < 0) return null;
    const t = (-linear - Math.sqrt(discriminant)) / square;
    return t >= 0 && t <= 1 ? t : null;
  }

  function updateBullets(dt) {
    for (const b of bullets) {
      if (b.life <= 0) continue;
      const from = { x: b.x, y: b.y }, travel = Math.min(dt, b.life);
      const to = { x: b.x + b.vx * travel, y: b.y + b.vy * travel };
      let hit = null;
      for (const wall of ballisticObstacles()) {
        const t = segmentHitsRect(from, to, wall);
        if (t !== null && (!hit || t < hit.t)) hit = { t, wall };
      }
      for (const zombie of zombies) if (zombie.alive) {
        const t = segmentHitsCircle(from, to, zombie, zombie.r + 1.5);
        if (t !== null && (!hit || t < hit.t)) hit = { t, zombie };
      }
      if (mission === 'destroy' && motherFound && mother && missionCoreHp > 0) {
        const t = segmentHitsCircle(from,to,mother,9);
        if (t !== null && (!hit || t < hit.t)) hit = {t,mother:true};
      }
      const fraction = hit ? hit.t : 1;
      b.x = from.x + (to.x - from.x) * fraction;
      b.y = from.y + (to.y - from.y) * fraction;
      b.life -= travel;
      if (!hit) continue;
      b.life = 0;
      if (hit.zombie) {
        hit.zombie.hp -= b.damage; hit.zombie.hit = .10;
        if (hit.zombie.hp <= 0) { hit.zombie.alive = false; kills++; }
      } else if (hit.mother) {
        missionCoreHp = Math.max(0, missionCoreHp - b.damage);
        if (missionCoreHp <= 0) finishGame(true);
      }
      particles.push({ x: b.x, y: b.y, life: .24, maxLife: .24, color: hit.wall ? '#d0b38c' : TYPES[b.type].color });
    }
  }
  const survivors = [];
  const zombies = [];
  const bullets = [];
  const particles = [];
  const TYPES = [
    { name: '机枪手', color: '#65c4c2', range: 245, ideal: 178, min: 82, damage: 6, speed: 76, cooldown: .11, count: 4, weapon: 'machine' },
    { name: '步枪手', color: '#72d08e', range: 260, ideal: 188, min: 64, damage: 14, speed: 86, cooldown: .34, count: 6, weapon: 'rifle' },
    { name: '狙击手', color: '#9ba8ee', range: 350, ideal: 276, min: 135, damage: 42, speed: 62, cooldown: 1.18, count: 4, weapon: 'sniper' },
    { name: '霰弹兵', color: '#e6a161', range: 164, ideal: 112, min: 38, damage: 9, speed: 96, cooldown: .78, count: 4, weapon: 'shotgun' },
  ];
  let live = false, paused = false, gameOver = false;
  let lastFrame = 0, elapsed = 0, spawnClock = 0, wave = 0, waveTime = 0, kills = 0;
  let gate = 100, speed = 1, decisionPending = false, lastDecisionAt = 0;
  const difficulty = { humans:18, zombies:16, hp:28, spawn:24 };
  let tacticalPlan = null, decisionHistory = [], orderOverlay = true;
  let postureSince = 0, postureStartKills = 0, postureStartCenter = null;
  let posture = 'DEFEND', modelLatency = null, modelRequests = 0, soundOn = false;
  let modelAvailable = false, toastTimer = 0, nextWaveIn = 0;
  const maxWaves = 6;
  const OBJECTIVES = {
    protect: { name: '保护种子库', instructions: 'Protect the seed vault. Preserve a defensive perimeter, intercept the heaviest approach, and retreat only if the vault or squad is in immediate danger.' },
    destroy: { name: '深入巢穴 · 摧毁母体', instructions: 'Infiltrate the maze nest. The small mother is hidden in an unknown room. Search unexplored rooms, avoid or clear zombies along the route, discover the mother through local vision, then destroy it. Visit supply points when ammunition is low.' },
  };
  const rand = (a, b) => a + Math.random() * (b - a);
  const nowLabel = () => {
    const total = Math.floor(elapsed);
    return `02:${String((17 + Math.floor(total / 60)) % 60).padStart(2, '0')}`;
  };

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
    draw();
  }
  new ResizeObserver(resize).observe(canvas);

  function seedSurvivors() {
    survivors.length = 0;
    let idx = 0;
    const counts = TYPES.map(type => Math.floor(difficulty.humans * type.count / 18));
    let remaining = difficulty.humans - counts.reduce((sum, count) => sum + count, 0);
    TYPES.map((type, i) => ({i, remainder:difficulty.humans * type.count / 18 - counts[i]})).sort((a,b)=>b.remainder-a.remainder).slice(0,remaining).forEach(({i})=>counts[i]++);
    TYPES.forEach((type, typeIndex) => {
      for (let n = 0; n < counts[typeIndex]; n++) {
        const angle = (idx / difficulty.humans) * Math.PI * 2;
        const dx = Math.cos(angle), dy = Math.sin(angle);
        const radius = 1 / Math.max(Math.abs(dx) / (house.w / 2 + 58), Math.abs(dy) / (house.h / 2 + 58));
        const pos = safePoint(mission === 'destroy' ? { x: (layout().entry?.x || field.x + 52) + idx % 6 * 15 - 37, y: (layout().entry?.y || field.y + 290) + Math.floor(idx / 6) * 12 - Math.floor(difficulty.humans / 12) * 12 } : { x: house.x + house.w / 2 + dx * radius, y: house.y + house.h / 2 + dy * radius }, 12);
        if (!pos) continue;
        survivors.push({
          x: pos.x, y: pos.y,
          homeX: 0, homeY: 0,
          type: typeIndex, hp: 100, maxHp: 100,
          cooldown: rand(0, type.cooldown), angle: -Math.PI / 2 + rand(-.15, .15),
          ammo: AMMO_CAPACITY[typeIndex], resupplying: false, supplyTimer: 0,
          alive: true, id: idx++, leader: idx === 1, targetId: null, planX: null, planY: null, replan: rand(0, .2),
        });
      }
    });
    survivors.forEach((unit, i) => { unit.homeX = unit.x; unit.homeY = unit.y; unit.rank = i; });
  }

  function spawnZombie(edge = null) {
    if (zombies.length >= 520) return;
    let side = edge ?? Math.floor(Math.random() * 4);
    let x, y;
    if (side === 0) { x = rand(field.x + 20, field.x + field.w - 20); y = field.y + 3; }
    if (side === 1) { x = field.x + field.w - 3; y = rand(field.y + 20, field.y + field.h - 20); }
    if (side === 2) { x = rand(field.x + 20, field.x + field.w - 20); y = field.y + field.h - 3; }
    if (side === 3) { x = field.x + 3; y = rand(field.y + 20, field.y + field.h - 20); }
    if (mission === 'destroy') {
      const site = searchSites()[Math.floor(Math.random() * searchSites().length)];
      x = site.x + rand(-50,50); y = site.y + rand(-50,50);
    }
    const elite = Math.random() < .085;
    const pos = safePoint({ x, y }, 12);
    if (!pos) return;
    x = pos.x; y = pos.y;
    zombies.push({ x, y, homeX:x, homeY:y, patrolTimer:0, hp: Math.round(difficulty.hp * (elite ? 1.65 : 1)), maxHp: Math.round(difficulty.hp * (elite ? 1.65 : 1)), speed: elite ? rand(18, 25) : rand(24, 34), damage: elite ? 2.0 : 1, r: elite ? 8 : rand(5.1, 7), elite, alive: true, hit: 0, id: Math.random() });
  }

  function beginWave() {
    if (wave >= maxWaves) return;
    wave += 1;
    waveTime = 0;
    spawnClock = 0;
    nextWaveIn = 0;
    for (let i = 0; i < Math.round(difficulty.zombies * (mission === 'destroy' ? 1 : 1 + (wave - 1) * .2)); i++) spawnZombie(i % 4);
    addLog(`第 ${String(wave).padStart(2, '0')} 波尸潮已抵达防区。`, 'alert');
    updateHud();
  }

  function startGame() {
    if (live || editingMap) return;
    battleVersion++;
    live = true; paused = false; gameOver = false;
    $('#start-overlay').classList.add('hidden');
    $('#phase-label').textContent = '战斗中';
    $('#pause-btn').textContent = 'Ⅱ';
    missionCoreHp = MOTHER_MAX_HP;
    addLog(`任务开始：${OBJECTIVES[mission].name}。`, 'safe');
    beginWave();
    lastFrame = performance.now();
    setPosture(mission === 'destroy' ? 'SCOUT' : 'DEFEND', '先执行初始部署，等待模型选择战术。', '初始部署');
    scheduleDecision(true);
  }

  function resetGame() {
    live = false; paused = false; gameOver = false;
    editingMap = false;
    $('#edit-map-btn').setAttribute('aria-pressed', 'false');
    canvas.parentElement.classList.remove('editing');
    battleVersion++;
    elapsed = 0; wave = 0; waveTime = 0; spawnClock = 0;
    kills = 0; gate = 100; missionCoreHp = MOTHER_MAX_HP; speed = 1; posture = mission === 'destroy' ? 'SCOUT' : 'DEFEND'; modelLatency = null;
    nextWaveIn = 0; lastDecisionAt = 0; tacticalPlan = null; decisionHistory = [];
    $('#decision-history').textContent = '';
    zombies.length = 0; bullets.length = 0; particles.length = 0;
    configureMission();
    seedSurvivors();
    $('#start-overlay').innerHTML = '<div class="start-emblem">◈</div><div class="start-title">防线已就绪</div><div class="start-copy">选择任务与地图，开始作战。</div><button class="start-btn" id="start-btn"><span>▶</span> 开始任务</button><div class="start-foot">自动战斗 · Laya 战术指挥</div>';
    $('#start-btn').addEventListener('click', startGame);
    $('#start-overlay').classList.remove('hidden');
    $('#phase-label').textContent = '待命';
    $('#log-count').textContent = '01';
    $('#event-log').innerHTML = '<div class="log-entry"><time>02:17</time><span class="log-marker safe"></span><p>守军已进入防御阵位，等待指令。</p></div>';
    $('#pause-btn').textContent = 'Ⅱ';
    $('#speed-btn').textContent = '1×';
    $('#wave-display').textContent = '01';
    $('#wave-progress').style.width = '0%';
    $('#day-count').textContent = '01';
    $('#model-raw').textContent = '模型原始建议：等待评估';
    $('#map-edit-hint').textContent = mapId === 'custom' ? '点击编辑地图添加或移除掩体' : '重置后可切换地图与任务';
    setPosture(mission === 'destroy' ? 'SCOUT' : 'DEFEND', `任务准备：${OBJECTIVES[mission].name}。`, '待命');
    updateExploration(.3);
    updateHud(); draw();
  }

  const TACTICS = {
    SCOUT: {label:'分队搜索',color:'#7edaca',effect:'步枪与霰弹分成两组搜索密室；机枪和狙击跟随掩护，优先清除沿途威胁。'},
    SUPPRESS: {label:'定点压制',color:'#f2bf67',effect:'全队围绕同一可见威胁建立射击线，优先攻击标记敌人，保留兵种安全距离。'},
    FLANK: {label:'侧翼包抄',color:'#83bcff',effect:'机枪与狙击在正面掩护；步枪与霰弹沿目标两翼绕行，形成交叉火力。'},
    ASSAULT: {label:'突击母体',color:'#ff8fdc',effect:'步枪与霰弹推进到母体射击位并优先打母体；机枪与狙击清除护卫。'},
    REGROUP: {label:'集合补给',color:'#e6d89b',effect:'全队回到安全补给点集合；缺弹单位补满，其余单位掩护，停止向巢穴深入。'},
    DEFEND: {label:'环形守卫',color:'#98d88c',effect:'围绕种子库分散设防，各自覆盖负责的方向，阻击靠近核心的僵尸。'},
  };

  function squadCenter() {
    const living = survivors.filter(s => s.alive);
    return living.length ? {x:living.reduce((n,s)=>n+s.x,0)/living.length,y:living.reduce((n,s)=>n+s.y,0)/living.length} : {...layout().entry || {x:160,y:330}};
  }

  function observedThreats() {
    return zombies.filter(z => z.alive && survivors.some(s => s.alive && distance(s,z) <= TYPES[s.type].range && !sightBlocked(s,z)));
  }

  function getSnapshot() {
    const living = survivors.filter(s => s.alive), center = squadCenter(), threats = observedThreats();
    const objective = mission === 'destroy' ? (motherFound ? mother : searchSites().find((_,i)=>!exploredRooms.has(i)) || searchSites()[0]) : {x:house.x+house.w/2,y:house.y+house.h/2};
    const lanes = [0,0,0,0];
    threats.forEach(z=>{const dx=z.x-objective.x,dy=z.y-objective.y;lanes[Math.abs(dx)>Math.abs(dy)?(dx>0?1:3):(dy>0?2:0)]++;});
    const state = {
      mission, objective_name:OBJECTIVES[mission].name,map:mapId,wave,seconds_into_wave:Math.round(waveTime),survivors:living.length,initial_humans:difficulty.humans,
      objective_integrity: mission==='destroy' && !motherFound ? null : Math.round(mission==='protect'?gate:missionCoreHp/MOTHER_MAX_HP*100),
      mother_core_visible:motherFound,mission_stage:mission==='protect'?'defend':motherFound?'eliminate':'search',rooms_searched:exploredRooms.size,rooms_total:searchSites().length,
      visible_zombies:threats.length,zombies_near_house:threats.filter(z=>distance(z,objective)<240).length,
      immediate_zombie_count:threats.filter(z=>distance(z,center)<115).length,
      squad_in_contact_danger:living.filter(s=>threats.some(z=>distance(s,z)<65&&!sightBlocked(s,z))).length,
      ammo_mode:ammoMode,squad_low_ammo:living.filter(s=>ammoMode==='finite'&&s.ammo<=AMMO_CAPACITY[s.type]*.2).length,
      squad_scattered:living.filter(s=>distance(s,center)>150).length,
      average_distance_to_objective:Math.round(living.reduce((n,s)=>n+distance(s,objective),0)/Math.max(1,living.length)),
      threat_by_lane:{north:lanes[0],east:lanes[1],south:lanes[2],west:lanes[3]},last_posture:posture,
      seconds_in_current_action:Math.round(elapsed-postureSince),kills_in_current_action:kills-postureStartKills,
      squad_moved_in_current_action:Math.round(postureStartCenter?distance(center,postureStartCenter):0),
    };
    state.available_actions = availableActions(state);
    return state;
  }

  function availableActions(state) {
    const actions = mission === 'destroy' ? [state.mother_core_visible?'ASSAULT':'SCOUT'] : ['DEFEND'];
    // A suppression order requires a visible target; never use hidden room population as enemy pressure.
    const stale = ['SUPPRESS','FLANK'].includes(state.last_posture) && state.seconds_in_current_action>=10 && state.kills_in_current_action===0 && state.squad_moved_in_current_action<15 && !state.squad_in_contact_danger;
    if((state.immediate_zombie_count>0 || state.squad_in_contact_danger>0) && !stale) actions.push('SUPPRESS');
    if(state.visible_zombies>=3 && state.survivors>=6 && !stale) actions.push('FLANK');
    if(state.squad_low_ammo>=Math.max(2,Math.ceil(state.survivors*.25)) || state.squad_scattered>=Math.max(4,Math.ceil(state.survivors*.25)) || state.squad_in_contact_danger>=Math.max(3,Math.ceil(state.survivors*.3))) actions.push('REGROUP');
    return actions;
  }

  function getRuleDecision(snapshot = getSnapshot()) {
    const allowed = snapshot.available_actions || availableActions(snapshot);
    let next = allowed[0];
    if(allowed.includes('REGROUP') && snapshot.squad_low_ammo>=Math.max(1,snapshot.survivors*.3)) next='REGROUP';
    else if(allowed.includes('SUPPRESS') && snapshot.squad_in_contact_danger>Math.max(1,snapshot.survivors*.2)) next='SUPPRESS';
    else if(allowed.includes('FLANK') && snapshot.visible_zombies>=snapshot.survivors) next='FLANK';
    return {posture:next,reason:`规则基线：${TACTICS[next].effect}`};
  }

  function applyMissionTactics(recommendation, snapshot = getSnapshot()) {
    const allowed = snapshot.available_actions || availableActions(snapshot);
    if(!allowed.includes(recommendation)) return {posture:allowed[0],reason:`状态更新：${postureLabel(recommendation)}已无可执行目标，转为${postureLabel(allowed[0])}。`};
    return {posture:recommendation,reason:null};
  }

  function setPosture(next, reason, source = '规则基线') {
    if(!TACTICS[next]) return;
    const changed = posture !== next || !tacticalPlan;
    if(changed) {postureSince=elapsed;postureStartKills=kills;postureStartCenter=squadCenter();}
    posture = next;
    tacticalPlan = buildTacticalPlan(next);
    tacticalPlan.source=source;
    survivors.forEach(s=>{s.replan=0;s.path=null;s.routeTimer=0;});
    $('#posture-value').textContent=postureLabel(next);
    $('#model-reason').textContent=reason || TACTICS[next].effect;
    $('#tactic-source').textContent=`${source} · ${postureLabel(next)}`;
    if(live || source==='Laya') {
      decisionHistory.push({second:Math.floor(elapsed),action:next,source});decisionHistory=decisionHistory.slice(-6);
      $('#decision-history').textContent='';
      decisionHistory.forEach(d=>{const span=document.createElement('span');span.textContent=`${d.second}s ${postureLabel(d.action)} · ${d.source}`;$('#decision-history').append(span);});
    }
  }

  function buildTacticalPlan(action) {
    const center=squadCenter(),observed=observedThreats();
    observed.sort((a,b)=>distance(a,center)-distance(b,center));
    const target=observed[0] || null;
    let anchor=center;
    if(action==='REGROUP') {
      const candidates=supplyPoints().map(p=>safePoint(p,10)).filter(Boolean).filter(p=>findPath(center,p,8).length);
      candidates.sort((a,b)=>(distance(a,center)+observed.filter(z=>distance(z,a)<100).length*100)-(distance(b,center)+observed.filter(z=>distance(z,b)<100).length*100));
      anchor=candidates[0]||safePoint({x:survivors[0]?.homeX||160,y:survivors[0]?.homeY||330},10)||center;
    }
    if(action==='DEFEND')anchor={x:house.x+house.w/2,y:house.y+house.h/2};
    if(action==='ASSAULT'&&motherFound)anchor={...mother};
    if(['SUPPRESS','FLANK'].includes(action)&&target)anchor={x:target.x,y:target.y};
    return {action,anchor,targetId:target?.id,created:elapsed};
  }

  function formationPoint(s, center, radius, angle) {
    for(const scale of [1,.7,.4]) {
      const p=safePoint({x:center.x+Math.cos(angle)*radius*scale,y:center.y+Math.sin(angle)*radius*scale},10);
      if(p&&findPath(s,p,8).length)return p;
    }
    return {x:s.x,y:s.y};
  }

  function tacticalGoal(s,type) {
    const plan=tacticalPlan||buildTacticalPlan(posture),center=squadCenter();
    const target=zombies.find(z=>z.alive&&z.id===plan.targetId);
    s.orderTargetId=target?.id??null;
    if(posture==='SCOUT') {
      s.role=(s.type===0||s.type===2)?'掩护搜索':'搜索密室';
      const sites=searchSites().map((p,i)=>({p,i})).filter(v=>!exploredRooms.has(v.i));
      sites.sort((a,b)=>distance(a.p,center)-distance(b.p,center));
      const options=sites.filter(v=>findPath(s,v.p,8).length);
      const group=s.type===3?1:0,goal=options[group%Math.max(1,options.length)]?.p||chooseSearchGoal(s);
      if(s.type===0||s.type===2) {
        const scouts=survivors.filter(a=>a.alive&&(a.type===1||a.type===3)).sort((a,b)=>distance(a,goal)-distance(b,goal));
        const scout=scouts[group%Math.max(1,scouts.length)];
        if(scout) { const dx=goal.x-scout.x,dy=goal.y-scout.y,d=Math.max(1,Math.hypot(dx,dy));const cover=safePoint({x:scout.x-dx/d*45,y:scout.y-dy/d*45},10);if(cover&&findPath(s,cover,8).length)return cover; }
      }
      return {...goal};
    }
    if(posture==='REGROUP') {s.role='集合 / 补给掩护';return formationPoint(s,plan.anchor,24+(s.rank%3)*14,s.rank*2.4);}
    if(posture==='DEFEND') {s.role='环形守卫';return {x:s.homeX,y:s.homeY};}
    if(posture==='ASSAULT') {
      const assault=s.type===1||s.type===3;
      s.role=assault?'主攻母体':'清除护卫';
      if(!assault&&target){const firing=pickFiringPosition(s,type,target);if(firing)return firing;}
      return chooseCorePosition(s,type)||{x:s.x,y:s.y};
    }
    if(target) {
      const flank=posture==='FLANK'&&(s.type===1||s.type===3);
      s.role=flank?'侧翼包抄':posture==='FLANK'?'正面掩护':'定点压制';
      if(flank) {
        const angle=Math.atan2(center.y-target.y,center.x-target.x)+(s.rank%2===0?1:-1)*1.25;
        return formationPoint(s,target,Math.min(type.ideal,140),angle);
      }
      const firing=pickFiringPosition(s,type,target);
      if(firing)return firing;
    }
    s.role='等待新目标';return {x:s.x,y:s.y};
  }

  async function scheduleDecision(force = false) {
    if (!live || paused || decisionPending) return;
    const selected = $('#model-select').value;
    const interval = selected === 'fast' ? 4 : 6;
    if (!force && elapsed - lastDecisionAt < interval) return;
    lastDecisionAt = elapsed;
    if (selected === 'fast') {
      const started = performance.now();
      const decision = getRuleDecision();
      setPosture(decision.posture, decision.reason);
      modelLatency = performance.now() - started;
      renderModelStats();
      return;
    }
    decisionPending = true;
    $('#model-call-state').textContent = '推理进行中…';
    const requestVersion = battleVersion;
    const reqStarted = performance.now();
    modelRequests += 1;
    try {
      const response = await fetch('/api/decision', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...getSnapshot(), mission_instructions: OBJECTIVES[mission].instructions }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '模型暂不可用');
      if (requestVersion === battleVersion && live && !paused) {
        const adapted = applyMissionTactics(result.posture, getSnapshot());
        showRawDecision(result);
        setPosture(adapted.posture, adapted.reason || result.reason, adapted.reason ? '状态更新' : 'Laya');
        modelLatency = result.latency_ms || performance.now() - reqStarted;
        addLog(`Laya 建议${postureLabel(result.posture)}，当前任务策略为${postureLabel(adapted.posture)}。`, 'safe');
      }
    } catch (error) {
      if (requestVersion !== battleVersion) return;
      const fallback = getRuleDecision();
      $('#model-raw').textContent = '模型离线 · 规则基线接管';
      setPosture(fallback.posture, `Laya 暂不可用，规则基线接管：${fallback.reason}`);
      $('#model-call-state').textContent = '使用回退策略';
      if (modelRequests === 1) toast('Laya 未连接，当前由规则基线接管。');
    } finally {
      decisionPending = false;
      if (!$('#model-call-state').textContent.includes('回退')) $('#model-call-state').textContent = '每 6 秒一次';
      renderModelStats();
      updateHud();
    }
  }

  function postureLabel(value) { return TACTICS[value]?.label || value; }

  function showRawDecision(result) {
    const percentages = Object.entries(result.probabilities || {}).map(([action, p]) => `${postureLabel(action)} ${Math.round(p * 100)}%`).join(' · ');
    $('#model-raw').textContent = `Laya 原始建议：${postureLabel(result.posture)}。${percentages}`;
  }

  function renderModelStats() {
    const ms = modelLatency;
    $('#decision-latency').textContent = ms === null ? '--' : Math.round(ms);
    $('#latency-label').textContent = ms === null ? '-- ms' : `${Math.round(ms)} ms`;
    $('#latency-meter').style.width = ms === null ? '0%' : `${Math.max(3, Math.min(ms / 1200 * 100, 100))}%`;
    $('#model-call-state').textContent = $('#model-select').value === 'fast' ? '即时 · 4 秒刷新' : '每 6 秒一次';
  }

  function distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

  function nearestZombie(s, range = Infinity) {
    let target = null, best = range;
    for (const z of zombies) {
      if (!z.alive) continue;
      const d = Math.hypot(z.x - s.x, z.y - s.y);
      if (d < best) { best = d; target = z; }
    }
    return target;
  }

  const lineBlockedByHouse = (a, b) => sightBlocked(a, b, 2);

  function pickFiringPosition(s, type, preferred = null) {
    let best = null, bestScore = Infinity;
    const threats = (preferred ? [preferred] : observedThreats()).filter(z => z.alive).sort((a, b) => distance(s, a) - distance(s, b)).slice(0, 12);
    for (const z of threats) {
      const currentDistance = distance(s, z);
      if (currentDistance > type.range * 1.55) continue;
      for (let i = 0; i < 20; i++) {
        const angle = i * Math.PI * 2 / 20;
        const radius = type.ideal + (i % 3 - 1) * 12;
        const x = z.x + Math.cos(angle) * radius;
        const y = z.y + Math.sin(angle) * radius;
        if (x < field.x + 14 || x > field.x + field.w - 14 || y < field.y + 14 || y > field.y + field.h - 14 || pointBlocked(x, y, 12)) continue;
        const candidate = { x, y };
        const range = distance(candidate, z);
        if (range < type.min || range > type.range || lineBlockedByHouse(candidate, z)) continue;
        const moveCost = distance(s, candidate);
        const crowding = survivors.reduce((sum, ally) => sum + (ally !== s && ally.alive && distance(candidate, ally) < 32 ? 32 - distance(candidate, ally) : 0), 0);
        const danger = threats.reduce((sum, other) => sum + (other !== z && distance(candidate, other) < 58 ? 58 - distance(candidate, other) : 0), 0);
        const anchor = posture === 'DEFEND' ? distance(candidate, { x: s.homeX, y: s.homeY }) * .65 : 0;
        const score = anchor + Math.abs(range - type.ideal) * .85 + moveCost * .20 + crowding * .75 + danger * .28 - Math.max(0, 230 - currentDistance) * .06 - (z === preferred ? 85 : 0);
        if (score < bestScore && findPath(s, candidate, 8).length) { bestScore = score; best = { x, y, target: z }; }
      }
    }
    return best;
  }

  function update(dt) {
    if (gameOver) return;
    elapsed += dt;
    updateExploration(dt);
    if (wave > 0 && wave <= maxWaves) {
      waveTime += dt;
      spawnClock += dt;
      const rate = difficulty.spawn > 0 ? 60 / difficulty.spawn : Infinity;
      if ((waveTime < 43 || mission === 'destroy') && spawnClock >= rate && zombies.filter(z => z.alive).length < (mission === 'destroy' ? 90 : 510)) {
        spawnClock = 0;
        spawnZombie(Math.random() < .62 ? 2 : null);
      }
      if (mission === 'protect' && waveTime > 43 && wave < maxWaves && !nextWaveIn) {
        nextWaveIn = 7;
        addLog(`第 ${wave} 波结束，下一波尸潮即将抵达。`, 'safe');
      }
      if (nextWaveIn > 0) {
        nextWaveIn -= dt;
        if (nextWaveIn <= 0) beginWave();
      }
      if (mission === 'protect' && waveTime > 43 && wave >= maxWaves && zombies.filter(z => z.alive).length === 0) finishGame(true);
    }
    if (gameOver) return;

    if(tacticalPlan && ['SUPPRESS','FLANK'].includes(posture) && !zombies.some(z=>z.alive&&z.id===tacticalPlan.targetId)) {
      const visible=observedThreats();
      if(visible.length){tacticalPlan=Object.assign(buildTacticalPlan(posture),{source:tacticalPlan.source});survivors.forEach(s=>s.replan=0);}
      else {setPosture(mission==='destroy'?(motherFound?'ASSAULT':'SCOUT'):'DEFEND','目标已清除，恢复任务路线。','目标完成');if(live)lastDecisionAt=-20;}
    }
    survivors.forEach(s => {
      if (!s.alive) return;
      const type=TYPES[s.type];
      s.ammo??=AMMO_CAPACITY[s.type];
      const supply=handleSupply(s,dt);
      s.replan-=dt;
      if(s.replan<=0) {
        s.orderGoal=tacticalGoal(s,type);s.replan=rand(.8,1.2);
      }
      let goal=supply||s.orderGoal;
      const closeThreat = zombies.filter(z=>z.alive&&distance(s,z)<58&&!sightBlocked(s,z)).sort((a,b)=>distance(s,a)-distance(s,b))[0];
      if(closeThreat&&!supply&&posture!=='REGROUP') {
        const dx=s.x-closeThreat.x,dy=s.y-closeThreat.y,d=Math.max(1,Math.hypot(dx,dy));
        const escape=safePoint({x:s.x+dx/d*42,y:s.y+dy/d*42},10);
        if(escape&&findPath(s,escape,8).length){goal=escape;s.evading=true;}else s.evading=false;
      }else s.evading=false;
      s.activeGoal=goal;
      moveAlongPath(s,goal,type.speed,dt,8);
      const target=zombies.find(z=>z.alive&&z.id===s.orderTargetId);
      const inSight=z=>z&&distance(s,z)<=type.range&&!sightBlocked(s,z,1);
      const local=zombies.filter(z=>z.alive&&inSight(z)).sort((a,b)=>distance(s,a)-distance(s,b))[0];
      const canHitCore=mission==='destroy'&&motherFound&&missionCoreHp>0&&inSight(mother);
      const primaryAssault=posture==='ASSAULT'&&(s.type===1||s.type===3);
      const fireAt=closeThreat|| (primaryAssault&&canHitCore?mother:inSight(target)?target:local||(posture==='ASSAULT'&&canHitCore?mother:null));
      if (fireAt && !(s.resupplying && s.supplyTimer>0) && (ammoMode === 'infinite' || s.ammo > 0)) {
        s.angle = Math.atan2(fireAt.y - s.y, fireAt.x - s.x);
        s.cooldown -= dt;
        if (s.cooldown <= 0) {
          s.cooldown = type.cooldown * rand(.83, 1.12);
          if(ammoMode==='finite')s.ammo=Math.max(0,s.ammo-(type.weapon==='machine'?2:1));
          const pellets = type.weapon === 'shotgun' ? 7 : type.weapon === 'machine' ? 2 : 1;
          const spread = type.weapon === 'shotgun' ? .22 : type.weapon === 'machine' ? .045 : type.weapon === 'sniper' ? .006 : .025;
          for (let p = 0; p < pellets; p++) {
            const shotAngle = s.angle + (pellets === 1 ? rand(-spread, spread) : (p - (pellets - 1) / 2) * spread + rand(-spread * .22, spread * .22));
            bullets.push({ x: s.x, y: s.y, vx: Math.cos(shotAngle) * (type.weapon === 'sniper' ? 620 : 430), vy: Math.sin(shotAngle) * (type.weapon === 'sniper' ? 620 : 430), damage: type.weapon === 'machine' ? type.damage / pellets : type.damage, life: Math.min(type.range / (type.weapon === 'sniper' ? 620 : 430), .72), type: s.type });
          }
        }
      }
    });

    updateBullets(dt);
    if (gameOver) { updateHud(); return; }
    const newInfections = [];
    for (const z of zombies) {
      if (!z.alive) continue;
      z.hit = Math.max(0, z.hit - dt);
      const s = nearestLivingSurvivor(z);
      const gx = door.x + door.w / 2, gy = door.y + 30;
      const target = mission === 'destroy' ? (s && distance(z,s)<230 && !sightBlocked(z,s) ? s : null) : (s && distance(z, s) < 76 ? s : { x: gx + Math.sin(z.id * 27) * 18, y: gy });
      if(mission==='destroy'&&!target) {
        z.patrolTimer=(z.patrolTimer||0)-dt;
        if(z.patrolTimer<=0){z.patrolGoal=safePoint({x:(z.homeX??z.x)+rand(-45,45),y:(z.homeY??z.y)+rand(-45,45)},z.r+3);z.patrolTimer=rand(4,7);}
      }
      const destination = target || z.patrolGoal || {x:z.x,y:z.y};
      moveAlongPath(z, destination, z.speed, dt, z.r + 2);
      if (distance(z, destination) <= z.r + 5 && target === s && s && !lineBlocked(z, s, 0)) {
        if (s.alive) {
          s.alive = false;
          newInfections.push({ x: s.x, y: s.y, hp: difficulty.hp, maxHp: difficulty.hp, speed: rand(26, 36), damage: 1, r: 6, elite: false, alive: true, hit: 0, id: Math.random() });
          addLog(`${TYPES[s.type].name}遭接触感染，已转化为僵尸。`, 'loss');
        }
      } else if (mission === 'protect' && target !== s && distance(z, destination) <= 13) {
        gate = Math.max(0, gate - z.damage * 1.9 * dt);
      }
      z.x = clamp(z.x, field.x + 4, field.x + field.w - 4);
      z.y = clamp(z.y, field.y + 4, field.y + field.h - 4);
    }
    zombies.push(...newInfections);
    for (const p of particles) p.life -= dt;
    for (let i = bullets.length - 1; i >= 0; i--) if (bullets[i].life <= 0) bullets.splice(i, 1);
    for (let i = zombies.length - 1; i >= 0; i--) if (!zombies[i].alive) zombies.splice(i, 1);
    for (let i = particles.length - 1; i >= 0; i--) if (particles[i].life <= 0) particles.splice(i, 1);
    if (mission === 'destroy' && elapsed >= 360) finishGame(false);
    if ((mission === 'protect' && gate <= 0) || survivors.every(s => !s.alive)) finishGame(false);
    if (elapsed - lastDecisionAt >= ($('#model-select').value === 'fast' ? 4 : 6)) scheduleDecision();
    updateHud();
  }

  function nearestLivingSurvivor(z) {
    let best = null, dBest = Infinity;
    for (const s of survivors) if (s.alive) {
      const d = Math.hypot(z.x - s.x, z.y - s.y);
      if (d < dBest) { best = s; dBest = d; }
    }
    return best;
  }

  function getFocusTarget() {
    if (!zombies.length) return null;
    const center = squadCenter();
    const buckets = [[], [], [], []];
    zombies.forEach(z => {
      const dx = z.x - center.x, dy = z.y - center.y;
      const side = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : (dy > 0 ? 2 : 0);
      buckets[side].push(z);
    });
    const lane = buckets.reduce((best, xs, i) => xs.length > buckets[best].length ? i : best, 0);
    return buckets[lane][0] || zombies[0];
  }

  function finishGame(won) {
    if (gameOver) return;
    gameOver = true; live = false;
    const missionWon = mission === 'destroy' && won;
    $('#phase-label').textContent = missionWon ? '母体摧毁' : won ? '防线守住' : '任务失败';
    $('#start-overlay').classList.remove('hidden');
    $('#start-overlay').innerHTML = `<div class="start-emblem">${won ? '✓' : '!'}</div><div class="start-title">${won ? `${OBJECTIVES[mission].name} · 完成` : '任务失败'}</div><div class="start-copy">累计击杀 ${kills} 只 · 存活 ${survivors.filter(s => s.alive).length} 人</div><button class="start-btn" id="restart-btn"><span>↻</span> 再来一次</button><div class="start-foot">${won ? 'OUTPOST 07 · SAFE' : 'OUTPOST 07 · LOST'}</div>`;
    $('#restart-btn').addEventListener('click', resetGame);
    addLog(missionWon ? '已找到并摧毁隐藏母体，巢穴威胁解除。' : won ? '最后一波尸潮已清除，防线成功守住。' : mission === 'destroy' ? '未能在时限内摧毁母体，撤离协议启动。' : '北门被突破，撤离协议启动。', won ? 'safe' : 'loss');
  }

  function draw() {
    if (!ctx || !canvas.width) return;
    ctx.clearRect(0, 0, W, H);
    const grad = ctx.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, '#172422'); grad.addColorStop(.55, '#101a1b'); grad.addColorStop(1, '#15211e');
    ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.beginPath(); ctx.rect(field.x, field.y, field.w, field.h); ctx.clip();
    ctx.fillStyle = '#13201e'; ctx.fillRect(field.x, field.y, field.w, field.h);
    ctx.strokeStyle = '#84958a12'; ctx.lineWidth = 1;
    for (let x = field.x; x < field.x + field.w; x += 34) { ctx.beginPath(); ctx.moveTo(x, field.y); ctx.lineTo(x, field.y + field.h); ctx.stroke(); }
    for (let y = field.y; y < field.y + field.h; y += 34) { ctx.beginPath(); ctx.moveTo(field.x, y); ctx.lineTo(field.x + field.w, y); ctx.stroke(); }
    drawTerrain(); drawHouse();
    if (mission === 'destroy') drawFog();
    bullets.forEach(b => { ctx.fillStyle = TYPES[b.type].color; ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 7; ctx.beginPath(); ctx.arc(b.x, b.y, b.type === 3 ? 2 : 1.6, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0; });
    survivors.forEach(drawSurvivor);
    zombies.forEach(z => {
      const visible = mission !== 'destroy' || survivors.some(s => s.alive && distance(s,z)<TYPES[s.type].range&&!sightBlocked(s,z));
      if (visible) drawZombie(z);
    });
    particles.forEach(p => { ctx.globalAlpha = Math.max(0, p.life / p.maxLife); ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1; });
    drawTacticalOverlay();
    drawMotherMarker();
    ctx.restore();
    drawFrame();
  }

  function drawTerrain() {
    const blueprint = layout();
    if (mission === 'destroy' && blueprint.nest) {
      ctx.fillStyle = '#201b29'; ctx.fillRect(blueprint.nest.x, blueprint.nest.y, blueprint.nest.w, blueprint.nest.h);
      ctx.strokeStyle = '#b68acb35'; ctx.lineWidth = 2; ctx.strokeRect(blueprint.nest.x, blueprint.nest.y, blueprint.nest.w, blueprint.nest.h);
      (blueprint.rooms || []).forEach(room => {
        ctx.fillStyle = '#352a3b'; ctx.fillRect(room.x, room.y, room.w, room.h);
        ctx.strokeStyle = '#b18bc344'; ctx.strokeRect(room.x, room.y, room.w, room.h);
        ctx.fillStyle = '#d6b6e044'; ctx.font = '9px sans-serif'; ctx.textAlign = 'left'; ctx.fillText(room.label || '巢室', room.x + 8, room.y + 15);
      });
    }
    if (mission === 'destroy' && blueprint.water) {
      const w = blueprint.water; ctx.fillStyle = '#183a4a'; ctx.fillRect(w.x, w.y, w.w, w.h);
      ctx.strokeStyle = '#55a5bd55'; ctx.lineWidth = 1;
      for (let y = w.y + 11; y < w.y + w.h; y += 18) { ctx.beginPath(); ctx.moveTo(w.x + 8, y); ctx.quadraticCurveTo(w.x + w.w / 2, y - 5, w.x + w.w - 8, y); ctx.stroke(); }
      (blueprint.bridges || []).forEach(b => { ctx.fillStyle = '#86633e'; ctx.fillRect(b.x, b.y, b.w, b.h); ctx.strokeStyle = '#d0a56b99'; for (let x = b.x + 8; x < b.x + b.w; x += 14) { ctx.beginPath(); ctx.moveTo(x, b.y); ctx.lineTo(x, b.y + b.h); ctx.stroke(); } });
    }
    ctx.strokeStyle = '#71807728'; ctx.lineWidth = 1;
    const trees = [[140,110],[192,588],[912,103],[970,552],[250,281],[882,268],[153,371],[987,355],[269,89],[860,608],[211,538],[932,180],[176,206],[947,465]];
    trees.forEach(([x,y],i)=>{
      ctx.fillStyle = i%3===0?'#263d32':'#20352d';
      ctx.beginPath();ctx.arc(x,y,rand(9,12),0,Math.PI*2);ctx.fill();
      ctx.strokeStyle='#62866a22';ctx.beginPath();ctx.arc(x,y,13,0,Math.PI*2);ctx.stroke();
    });
    const sand = [[255,501,27,10],[842,135,35,8],[282,144,19,7],[858,507,31,9],[213,432,26,7]];
    ctx.fillStyle='#d2b47a12';sand.forEach(([x,y,rx,ry])=>{ctx.beginPath();ctx.ellipse(x,y,rx,ry,0,0,Math.PI*2);ctx.fill();});
    ctx.fillStyle='#24332d';
    [[286,520,13],[848,220,10],[253,185,8],[864,382,13],[279,334,9]].forEach(([x,y,r])=>{ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();});
    activeObstacles().filter(r => r !== house).forEach(r => {
      if (r.kind === 'water') return;
      ctx.fillStyle = r.kind === 'slit' ? '#3a2d35' : '#26312d'; ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = '#84958a60'; ctx.lineWidth = 1; ctx.strokeRect(r.x + .5, r.y + .5, r.w - 1, r.h - 1);
      ctx.fillStyle = '#a0ad9d18'; ctx.fillRect(r.x + 5, r.y + 5, Math.max(0, r.w - 10), 4);
      if (r.kind === 'slit') { ctx.strokeStyle = '#e2bb78aa'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(r.x + 2, r.y + r.h / 2); ctx.lineTo(r.x + r.w - 2, r.y + r.h / 2); ctx.stroke(); }
    });
    if (mission === 'destroy') {
      (blueprint.searchSites || []).forEach((p, i) => { if (!exploredRooms.has(i)) { ctx.fillStyle = '#d7b76b99'; ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fill(); } });
      (blueprint.supplies || []).forEach(p => { ctx.fillStyle = '#d5ae55'; ctx.fillRect(p.x - 7, p.y - 6, 14, 12); ctx.strokeStyle = '#f3d68d'; ctx.strokeRect(p.x - 7, p.y - 6, 14, 12); });
    }
  }

  function drawFog() {
    const blueprint = layout();
    if (!blueprint.nest) return;
    ctx.save(); ctx.beginPath(); ctx.rect(blueprint.nest.x, blueprint.nest.y, blueprint.nest.w, blueprint.nest.h); ctx.clip();
    ctx.fillStyle = '#090b14b8';
    for(let cx=0;cx<Math.ceil(field.w/FOG_CELL);cx++)for(let cy=0;cy<Math.ceil(field.h/FOG_CELL);cy++) {
      if(!seenCells.has(`${cx},${cy}`))ctx.fillRect(field.x+cx*FOG_CELL,field.y+cy*FOG_CELL,FOG_CELL,FOG_CELL);
    }
    ctx.restore();
  }

  function drawHouse() {
    if (mission === 'destroy') {
      const nest = layout().nest;
      if (!nest) return;
      ctx.save(); ctx.strokeStyle = '#b68acb80'; ctx.lineWidth = 2; ctx.strokeRect(nest.x, nest.y, nest.w, nest.h);
      ctx.restore(); return;
    }
    ctx.save();
    ctx.shadowColor = '#07100d'; ctx.shadowBlur = 26; ctx.shadowOffsetY = 5;
    ctx.fillStyle = '#202d2b'; ctx.fillRect(house.x, house.y, house.w, house.h);
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = '#273534'; ctx.fillRect(house.x + 8, house.y + 8, house.w - 16, house.h - 16);
    ctx.fillStyle = '#1c2928'; ctx.fillRect(house.x + 22, house.y + 19, house.w - 44, house.h - 38);
    ctx.strokeStyle = '#81969170'; ctx.lineWidth = 2; ctx.strokeRect(house.x, house.y, house.w, house.h);
    ctx.strokeStyle = '#64797540'; ctx.lineWidth = 1;
    for(let x=house.x+35;x<house.x+house.w-20;x+=47){ctx.beginPath();ctx.moveTo(x,house.y+10);ctx.lineTo(x,house.y+house.h-10);ctx.stroke();}
    for(let y=house.y+34;y<house.y+house.h-10;y+=44){ctx.beginPath();ctx.moveTo(house.x+10,y);ctx.lineTo(house.x+house.w-10,y);ctx.stroke();}
    ctx.fillStyle='#202c28'; ctx.fillRect(house.x+12,house.y+12,34,9); ctx.fillRect(house.x+house.w-47,house.y+12,34,9);
    ctx.fillStyle='#9a8b6d'; ctx.fillRect(house.x+20,house.y+house.h-42,13,17); ctx.fillRect(house.x+house.w-33,house.y+house.h-42,13,17);
    ctx.fillStyle='#344340'; ctx.fillRect(door.x-4,door.y-15,door.w+8,32);
    ctx.fillStyle=gate<35?'#95534d':gate<65?'#a17e54':'#7c9e82'; ctx.fillRect(door.x,door.y,door.w,7);
    ctx.fillStyle='#d3bf8d';ctx.fillRect(door.x+4,door.y+1,4,5);ctx.fillRect(door.x+door.w-8,door.y+1,4,5);
    ctx.strokeStyle='#cc9470';ctx.globalAlpha=.12+Math.sin(elapsed*7)*.08;ctx.lineWidth=2;ctx.strokeRect(door.x-8,door.y-9,door.w+16,25);ctx.globalAlpha=1;
    ctx.fillStyle = '#d8e2d9'; ctx.font = '10px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('种子库', house.x + house.w / 2, house.y + house.h / 2);
    ctx.restore();
  }

  function drawMotherMarker() {
    if(mission!=='destroy'||!motherFound||!mother)return;
    const {x,y}=mother;ctx.save();
    const pulse=27+Math.sin(elapsed*4)*4;
    ctx.strokeStyle='#ff93d9';ctx.lineWidth=2.5;ctx.beginPath();ctx.arc(x,y,pulse,0,Math.PI*2);ctx.stroke();
    ctx.strokeStyle='#fff1fb';ctx.lineWidth=2;
    for(const [dx,dy]of [[1,0],[-1,0],[0,1],[0,-1]]){ctx.beginPath();ctx.moveTo(x+dx*34,y+dy*34);ctx.lineTo(x+dx*43,y+dy*43);ctx.stroke();}
    ctx.shadowColor='#ff81d7';ctx.shadowBlur=20;ctx.fillStyle=missionCoreHp>0?'#ff9de1':'#756177';ctx.beginPath();ctx.arc(x,y,9,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;
    ctx.fillStyle='#fff0fa';ctx.beginPath();ctx.arc(x,y,3,0,Math.PI*2);ctx.fill();
    const lx=clamp(x,field.x+84,field.x+field.w-84),ly=y>field.y+80?y-60:y+49;
    ctx.fillStyle='#271527ef';ctx.fillRect(lx-78,ly-16,156,38);ctx.strokeStyle='#ff9de1';ctx.lineWidth=1;ctx.strokeRect(lx-78,ly-16,156,38);
    ctx.textAlign='center';ctx.font='bold 12px sans-serif';ctx.fillStyle='#ffe5f8';ctx.fillText(missionCoreHp>0?'◆ 母体 · 已发现':'✓ 母体 · 已摧毁',lx,ly);
    ctx.fillStyle='#ff8fdc';ctx.fillRect(lx-69,ly+9,138*Math.max(0,missionCoreHp)/MOTHER_MAX_HP,4);
    ctx.restore();
  }

  function drawTacticalOverlay() {
    if(!orderOverlay||!tacticalPlan||!live&&!gameOver)return;
    ctx.save();const color=TACTICS[posture].color;
    ctx.strokeStyle=color;ctx.lineWidth=1;ctx.setLineDash([4,5]);ctx.globalAlpha=.4;
    survivors.filter(s=>s.alive).forEach(s=>{
      if(!s.activeGoal)return;
      ctx.beginPath();ctx.moveTo(s.x,s.y);
      (s.path?.slice(s.pathIndex)||[s.activeGoal]).forEach(p=>ctx.lineTo(p.x,p.y));ctx.stroke();
      ctx.beginPath();ctx.arc(s.activeGoal.x,s.activeGoal.y,4,0,Math.PI*2);ctx.stroke();
    });
    ctx.globalAlpha=1;ctx.setLineDash([]);
    const target=zombies.find(z=>z.alive&&z.id===tacticalPlan.targetId);
    let anchor=target||tacticalPlan.anchor;
    if(posture==='SCOUT')anchor=survivors.find(s=>s.alive&&s.type===1)?.orderGoal||anchor;
    if(anchor&&posture!=='ASSAULT') {
      ctx.strokeStyle=color;ctx.lineWidth=2;ctx.beginPath();ctx.arc(anchor.x,anchor.y,18,0,Math.PI*2);ctx.stroke();
      ctx.fillStyle='#0d181aee';ctx.fillRect(anchor.x-46,anchor.y-40,92,17);ctx.font='10px sans-serif';ctx.fillStyle=color;ctx.textAlign='center';ctx.fillText(postureLabel(posture),anchor.x,anchor.y-28);
    }
    ctx.restore();
  }

  function drawSurvivor(s) {
    if (!s.alive) return;
    const type = TYPES[s.type];
    ctx.save();
    ctx.strokeStyle = `${type.color}27`; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(s.x + Math.cos(s.angle) * 15, s.y + Math.sin(s.angle) * 15); ctx.stroke();
    ctx.fillStyle = '#06100d77'; ctx.beginPath(); ctx.ellipse(s.x, s.y + 4.4, 5, 2.5, 0, 0, Math.PI*2); ctx.fill();
    ctx.shadowColor=type.color;ctx.shadowBlur=s.leader?11:6;ctx.fillStyle=type.color;ctx.beginPath();ctx.arc(s.x,s.y,s.leader?5.2:4.2,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;
    ctx.fillStyle='#eaf6eb';ctx.beginPath();ctx.arc(s.x-1,s.y-1,1.2,0,Math.PI*2);ctx.fill();
    if(ammoMode==='finite'){ctx.fillStyle='#324238';ctx.fillRect(s.x-6,s.y+9,12,2);ctx.fillStyle=s.resupplying?'#f2c96c':type.color;ctx.fillRect(s.x-6,s.y+9,12*s.ammo/AMMO_CAPACITY[s.type],2);}
    if(s.resupplying){ctx.strokeStyle='#f2c96c';ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(s.x,s.y,9,0,Math.PI*2);ctx.stroke();}
    ctx.restore();
  }

  function drawZombie(z) {
    ctx.save();
    ctx.fillStyle='#050b0acc';ctx.beginPath();ctx.ellipse(z.x,z.y+z.r*.58,z.r*1.1,z.r*.48,0,0,Math.PI*2);ctx.fill();
    const color=z.hit?'#ffd9d1':z.elite?'#d592ff':'#a36bcb';
    ctx.shadowColor=color;ctx.shadowBlur=z.elite?9:4;ctx.fillStyle=color;ctx.beginPath();ctx.arc(z.x,z.y,z.r,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;
    ctx.fillStyle=z.elite?'#f2ddff':'#dcc6ed';ctx.globalAlpha=.88;ctx.beginPath();ctx.arc(z.x-1.7,z.y-1.7,z.r*.34,0,Math.PI*2);ctx.fill();ctx.globalAlpha=1;
    if(z.elite){ctx.strokeStyle='#e7c2ff';ctx.lineWidth=1;ctx.beginPath();ctx.arc(z.x,z.y,z.r+2,0,Math.PI*2);ctx.stroke();}
    ctx.restore();
  }

  function drawFrame() {
    ctx.strokeStyle='#90a99a40';ctx.lineWidth=1;ctx.strokeRect(field.x,field.y,field.w,field.h);
    ctx.fillStyle='#c4d0c744';
    const marks=[[field.x,field.y,1,1],[field.x+field.w,field.y,-1,1],[field.x,field.y+field.h,1,-1],[field.x+field.w,field.y+field.h,-1,-1]];
    marks.forEach(([x,y,sx,sy])=>{ctx.fillRect(x+(sx<0?-1:0),y,1,17);ctx.fillRect(x,y+(sy<0?-1:0),17,1);});
  }

  function frame(t) {
    const realDt = lastFrame ? Math.min((t-lastFrame)/1000, .055) : .016;
    lastFrame = t;
    if (live && !paused) update(realDt * speed);
    if (live && !paused) scheduleDecision();
    draw();
    requestAnimationFrame(frame);
  }

  function updateHud() {
    const alive = survivors.filter(s => s.alive);
    const typeCounts = TYPES.map((_, i) => alive.filter(s => s.type === i).length);
    $('#human-count').textContent = String(alive.length).padStart(3, '0');
    $('#zombie-count').textContent = String(zombies.length).padStart(3, '0');
    $('#zombie-alive').textContent = String(zombies.length).padStart(3, '0');
    $('#horde-total').textContent = String(zombies.length).padStart(3, '0');
    $('#kills-total').textContent = String(kills).padStart(3, '0');
    $('#roster-alive').textContent = alive.length;
    $('#roster-total').textContent = survivors.length;
    $('#roster-lost').textContent = survivors.length - alive.length;
    $('#machine-count').textContent = typeCounts[0];
    $('#rifle-count').textContent = typeCounts[1];
    $('#sniper-count').textContent = typeCounts[2];
    $('#shotgun-count').textContent = typeCounts[3];
    const objectiveHp = mission === 'protect' ? gate : missionCoreHp / MOTHER_MAX_HP * 100;
    $('#gate-label').textContent = mission === 'protect' ? '种子库耐久' : (motherFound ? '母体生命' : '母体未发现');
    $('#gate-health').style.width = mission==='destroy'&&!motherFound?'0%':`${objectiveHp}%`;
    $('#gate-value').textContent = mission==='destroy'&&!motherFound?'?':`${Math.round(objectiveHp)}%`;
    $('#gate-health').style.background = mission==='destroy'&&!motherFound?'#69756d':mission === 'destroy' ? '#bc8be8' : objectiveHp < 30 ? '#de746b' : objectiveHp < 60 ? '#e2a265' : '#dfad76';
    $('#clock').textContent = `第 ${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(Math.floor(elapsed % 60)).padStart(2, '0')} 分钟`;
    $('#day-count').textContent = String(Math.max(1, Math.floor(elapsed / 90) + 1)).padStart(2, '0');
    $('#wave-display').textContent = String(Math.min(wave || 1, maxWaves)).padStart(2, '0');
    $('#wave-progress').style.width = `${wave ? Math.min(waveTime / 43 * 100, 100) : 0}%`;
    $('#next-wave').textContent = wave === 0 ? '准备中' : mission==='destroy' ? (difficulty.spawn?`${Math.ceil(Math.max(0,60/difficulty.spawn-spawnClock))}s 增援`:'无增援') : nextWaveIn > 0 ? `${Math.ceil(nextWaveIn)}s` : wave < maxWaves ? `${Math.max(0, Math.ceil(43-waveTime))}s` : '最后一波';
    document.querySelectorAll('.wave-dot').forEach((d, i) => { d.classList.toggle('active', i === wave - 1); d.classList.toggle('done', i < wave - 1); });
    $('#breach-alert').classList.toggle('visible', mission === 'protect' && gate < 58 && live);
    $('#model-select').disabled = decisionPending;
    for(const id of ['human-setting','zombie-setting','hp-setting','spawn-setting','difficulty-preset'])$('#'+id).disabled=live;
    $('#map-select').disabled = live;
    $('#objective-select').disabled = live;
    $('#ammo-select').disabled = live;
    $('#edit-map-btn').disabled = live;
    $('#import-map-btn').disabled = live;
    $('#export-map-btn').disabled = mapId !== 'custom';
    const lowAmmo = alive.filter(s => ammoMode === 'finite' && s.ammo < AMMO_CAPACITY[s.type] * .2).length;
    const totalAmmo = ammoMode === 'infinite' ? '∞' : alive.reduce((sum, s) => sum + Math.max(0, Math.round(s.ammo ?? 0)), 0);
    $('#mission-stage').textContent = mission === 'protect' ? '守卫种子库' : motherFound ? '母体已定位 · 消灭阶段' : `搜索巢穴密室 ${exploredRooms.size}/${searchSites().length}`;
    $('#ammo-status').textContent = ammoMode === 'infinite' ? '弹药 ∞' : `余弹 ${totalAmmo}${lowAmmo ? ` · ${lowAmmo} 人低弹` : ''}`;
    $('#supply-status').textContent = ammoMode === 'finite' ? `补给 ${supplyVisits} 次 · ${alive.filter(s => s.resupplying).length} 人途中` : '补给模式未启用';
    $('#mission-stage').classList.toggle('mother-chip',mission==='destroy'&&motherFound);
    const roles={};alive.forEach(s=>{const role=s.resupplying?'缺弹补给':s.evading?'近身避险':s.role;if(role)roles[role]=(roles[role]||0)+1;});
    $('#tactic-effect').textContent=TACTICS[posture].effect+' '+Object.entries(roles).map(([r,n])=>`${r} ${n}人`).join(' · ');
    const view=getSnapshot();
    $('#tactic-input').textContent=`已观察敌人 ${view.visible_zombies} · 近身受威胁 ${view.squad_in_contact_danger} · 低弹 ${view.squad_low_ammo}\n候选：${view.available_actions.map(postureLabel).join(' / ')}`;
    $('#difficulty-summary').textContent=`${difficulty.humans} 人 · 首波 ${difficulty.zombies} 尸 · ${difficulty.hp} HP`;
    const rows = ['machine-count','rifle-count','sniper-count','shotgun-count'];
    rows.forEach((id, i) => {
      const row = $(`#${id}`)?.parentElement;
      const bar = row && typeof row.querySelector === 'function' ? row.querySelector('.unit-bar i') : null;
      if (bar) { const group = alive.filter(s => s.type === i); const pct = ammoMode === 'infinite' ? 100 : group.reduce((sum, s) => sum + (s.ammo / AMMO_CAPACITY[i]), 0) / Math.max(1, group.length) * 100; bar.style.width = `${Math.max(0, pct)}%`; }
    });
  }

  function addLog(message, kind='safe') {
    const entry = document.createElement('div'); entry.className = 'log-entry';
    const time = document.createElement('time'); time.textContent = nowLabel();
    const marker = document.createElement('span'); marker.className = `log-marker ${kind}`;
    const p = document.createElement('p'); p.textContent = message;
    entry.append(time, marker, p);
    $('#event-log').prepend(entry);
    while ($('#event-log').children.length > 5) $('#event-log').lastElementChild.remove();
    const count = $('#event-log').children.length;
    $('#log-count').textContent = String(count).padStart(2, '0');
  }

  function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
  function toast(message) {
    $('#toast').textContent = message;
    $('#toast').classList.add('visible');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 2700);
  }

  async function checkModel() {
    try {
      const r = await fetch('/api/status'); const data = await r.json();
      modelAvailable = !!data.model_available;
      $('#model-availability').textContent = modelAvailable ? '模型服务已就绪' : '模型服务离线';
      if (!modelAvailable) $('#model-availability').title = '请启动 Laya 本地决策服务，使用 typed-decisions 检查点';
      $('.model-live').innerHTML = `<i></i>${modelAvailable ? '已就绪' : '离线回退'}`;
      $('.model-live').style.color = modelAvailable ? '#99bda1' : '#dfac81';
      $('.model-live i').style.background = modelAvailable ? '#71ce8c' : '#e2a265';
    } catch (_) {
      $('#model-availability').textContent = '启动 Laya 本地决策服务';
    }
  }

  $('#start-btn').addEventListener('click', startGame);
  $('#pause-btn').addEventListener('click', () => {
    if (!live) return;
    paused = !paused; $('#pause-btn').textContent = paused ? '▶' : 'Ⅱ';
    $('#phase-label').textContent = paused ? '已暂停' : '战斗中';
    if (!paused) scheduleDecision();
  });
  $('#speed-btn').addEventListener('click', () => { speed = speed === 1 ? 1.5 : speed === 1.5 ? 2 : 1; $('#speed-btn').textContent = `${speed}×`; });
  $('#reset-btn').addEventListener('click', resetGame);
  $('#map-select').addEventListener('change', event => {
    editingMap = false;
    $('#edit-map-btn').setAttribute('aria-pressed', 'false');
    $('#arena').parentElement.classList.remove('editing');
    applyMap(event.target.value);
    resetGame();
    $('#map-edit-hint').textContent = mapId === 'custom' ? '编辑模式：点击空地添加掩体，点击掩体移除' : '选择地图与任务后开始';
  });
  const difficultyPresets={easy:{humans:28,zombies:10,hp:18,spawn:12},normal:{humans:18,zombies:16,hp:28,spawn:24},hard:{humans:12,zombies:40,hp:65,spawn:60}};
  const difficultyFields={humans:'human-setting',zombies:'zombie-setting',hp:'hp-setting',spawn:'spawn-setting'};
  const difficultyBounds={humans:[4,60],zombies:[0,160],hp:[10,300],spawn:[0,120]};
  for(const [key,id] of Object.entries(difficultyFields))$('#'+id).addEventListener('change',event=>{
    if(live)return;
    const value=Number(event.target.value),[min,max]=difficultyBounds[key];
    difficulty[key]=Number.isFinite(value)?Math.round(clamp(value,min,max)):difficulty[key];event.target.value=difficulty[key];
    $('#difficulty-preset').value='custom';resetGame();
  });
  $('#difficulty-preset').addEventListener('change',event=>{
    if(live||!difficultyPresets[event.target.value])return;
    Object.assign(difficulty,difficultyPresets[event.target.value]);
    for(const [key,id]of Object.entries(difficultyFields))$('#'+id).value=difficulty[key];
    resetGame();
  });
  $('#show-orders').addEventListener('change',event=>{orderOverlay=event.target.checked;draw();});
  $('#objective-select').addEventListener('change', event => {
    mission = event.target.value;
    resetGame();
    setPosture(mission === 'destroy' ? 'SCOUT' : 'DEFEND', `任务已切换：${OBJECTIVES[mission].name}。`);
    $('#model-reason').textContent = mission === 'protect' ? '守卫种子库，撑过 6 波尸潮；Laya 每 6 秒评估布防。' : '从西侧入口探索巢穴，发现并摧毁隐藏母体；Laya 每 6 秒评估推进、清障和撤退。';
  });
  $('#ammo-select').addEventListener('change', event => {
    ammoMode = event.target.value === 'finite' ? 'finite' : 'infinite';
    resetGame();
    $('#model-reason').textContent = ammoMode === 'finite' ? '有限弹药：弹药不足的单位会自动寻找补给点，停留 2 秒后返回任务。' : '无限弹药：单位无需补给，专注执行当前任务。';
  });
  $('#edit-map-btn').addEventListener('click', () => {
    if (mapId !== 'custom') {
      $('#map-select').value = 'custom';
      applyMap('custom');
      resetGame();
    }
    editingMap = !editingMap;
    $('#edit-map-btn').setAttribute('aria-pressed', String(editingMap));
    $('#arena').parentElement.classList.toggle('editing', editingMap);
    $('#start-overlay').classList.toggle('hidden', editingMap);
    $('#map-edit-hint').textContent = editingMap ? '点击空地添加掩体，点击掩体移除；自动保存' : '自定义地图已保存到本机';
    if (!editingMap) toast('自定义地图已保存到本机浏览器。');
  });
  canvas.addEventListener('click', event => {
    if (!editingMap) return;
    const rect = canvas.getBoundingClientRect();
    editCustomMap((event.clientX - rect.left) / rect.width * W, (event.clientY - rect.top) / rect.height * H);
  });
  $('#export-map-btn').addEventListener('click', () => {
    const obstacles = mapId === 'custom' ? customObstacles : MAPS[mapId].obstacles;
    const blob = new Blob([JSON.stringify({ version: 1, obstacles }, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob); link.download = `last-house-${mapId}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  });
  $('#import-map-btn').addEventListener('click', () => $('#import-map-file').click());
  $('#import-map-file').addEventListener('change', async event => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      if (file.size > 24000) throw new Error('地图文件过大，请限制在 24 KB 内。');
      const parsed = JSON.parse(await file.text());
      const previousHouse = house;
      let imported;
      try { house = { x: 412, y: 248, w: 296, h: 190 }; imported = validateCustomMap(parsed); }
      finally { house = previousHouse; }
      localStorage.setItem('last-house-custom-map', JSON.stringify(imported));
      $('#map-select').value = 'custom'; applyMap('custom'); resetGame();
      toast(`已导入 ${imported.length} 个掩体。`);
    } catch (error) { toast(`导入失败：${error.message}`); }
    finally { event.target.value = ''; }
  });
  $('#model-select').addEventListener('change', () => {
    modelLatency = null; renderModelStats();
    const isLaya = $('#model-select').value === 'laya';
    $('#model-reason').textContent = isLaya ? 'Laya 直接评估有限战术选项；战场物理、移动和射击持续由本地模拟运行。' : '规则策略即时输出战术，作为本地确定性基线。';
    if (live) { lastDecisionAt = -20; scheduleDecision(true); }
  });
  $('#test-model').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    if ($('#model-select').value === 'fast') {
      const started = performance.now();
      const decision = performance.now()-started;
      modelLatency = decision;
      const danger=zombies.length>36||gate<48;
      $('#model-raw').textContent = '规则基线 · 本次没有调用 Laya';
      const baseline = getRuleDecision();
      setPosture(baseline.posture, baseline.reason);
      addLog('Fast Policy 本地策略完成一次状态决策。','safe');
      renderModelStats(); toast(`Fast Policy 响应 ${decision.toFixed(2)} ms`); return;
    }
    button.disabled = true; $('#model-call-state').textContent = '测试推理中…';
    const testVersion = battleVersion;
    const started = performance.now();
    try {
      const r=await fetch('/api/decision',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...getSnapshot(),mission_instructions:OBJECTIVES[mission].instructions})});
      const result=await r.json();if(!r.ok)throw new Error(result.error||'调用失败');
      if (testVersion !== battleVersion) return;
      const adapted = applyMissionTactics(result.posture, getSnapshot());
      showRawDecision(result);
      modelLatency=result.latency_ms||performance.now()-started;setPosture(adapted.posture,adapted.reason||result.reason,adapted.reason?'状态更新':'Laya');
      addLog(`模型响应 ${Math.round(modelLatency)} ms，建议${postureLabel(result.posture)}，任务策略${postureLabel(adapted.posture)}。`,'safe');
      toast(`Laya 本地响应 ${Math.round(modelLatency)} ms`);
    }catch(error){toast('Laya 连接失败，战斗继续由规则基线接管。');$('#model-call-state').textContent='模型离线';}
    finally{button.disabled=false;renderModelStats();updateHud();}
  });
  $('#help-btn').addEventListener('click',()=>$('#help-modal').hidden=false);
  $('#close-modal').addEventListener('click',()=>$('#help-modal').hidden=true);
  $('#close-modal-ok').addEventListener('click',()=>$('#help-modal').hidden=true);
  $('#help-modal').addEventListener('click',e=>{if(e.target.id==='help-modal')e.currentTarget.hidden=true;});
  $('#roster-detail').addEventListener('click',()=>toast('机枪压制、步枪均衡输出、狙击远程点杀、霰弹近距爆发。'));
  $('#sound-toggle').addEventListener('click',()=>{soundOn=!soundOn;$('#sound-toggle').style.color=soundOn?'#bce6c2':'';toast(soundOn?'音效已开启（原型暂不播放音频）':'音效已关闭');});

  $('#map-select').value = 'labyrinth';
  applyMap('labyrinth');
  resetGame();
  renderModelStats();
  checkModel();
  resize();
  requestAnimationFrame(frame);
})();

const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const noop = () => {};
const elements = new Map();
const ctx = new Proxy({ createLinearGradient: () => ({ addColorStop: noop }) }, { get: (o, k) => o[k] || noop });
const element = () => ({ textContent: '', value: 'fast', style: {}, width: 1120, height: 690, classList: { add: noop, remove: noop, toggle: noop }, children: [], parentElement: { classList: { toggle: noop, remove: noop } }, addEventListener: noop, setAttribute: noop, prepend: noop, getContext: () => ctx, getBoundingClientRect: () => ({ width: 1120, height: 690 }), append: noop });
const document = { querySelector: s => { if (!elements.has(s)) elements.set(s, element()); return elements.get(s); }, querySelectorAll: () => [], createElement: element };
const box = { document, console, performance, ResizeObserver: class { observe() {} }, devicePixelRatio: 1, requestAnimationFrame: noop, fetch: async () => ({ json: async () => ({ model_available: true }) }), localStorage: { getItem: () => null, setItem: noop }, setTimeout: noop, clearTimeout: noop };
const mapsSource = fs.readFileSync(require('node:path').join(__dirname, '../maps.js'), 'utf8');
let source = fs.readFileSync(require('node:path').join(__dirname, '../game.js'), 'utf8');
source = source.replace(/\}\)\(\);\s*$/, `globalThis.sim = { MAPS, TYPES, difficulty, setPosture, tacticalGoal, availableActions, spawnZombie, beginWave, drawMotherMarker, drawFog, survivors, zombies, bullets, applyMap, resetGame, update, findPath, moveAlongPath, activeObstacles, pointBlocked, lineBlocked, sightBlocked, updateBullets, validateCustomMap, segmentHitsRect, applyMissionTactics, getSnapshot, searchSites, supplyPoints, handleSupply, get motherState(){return {mother, motherFound};}, revealMother: p => { mother=p;motherFound=true; }, setClock: t=>elapsed=t, setMission: m => mission = m, setAmmoMode: m => ammoMode = m, setCustom: rs => { mapId = 'custom'; customObstacles = rs; navigationGraphs.clear(); }, setWave: (w,t) => { wave=w; waveTime=t; }, isOver: () => gameOver, coreHP: () => missionCoreHp }; })();`);
vm.runInNewContext(mapsSource, box);
vm.runInNewContext(source, box);
const g = box.sim;
let checks = 0;
function ok(value, message) { assert(value, message); checks++; }
// Test path reachability and full swept movement through a map with a core between endpoints.
g.applyMap('ridge'); g.resetGame();
const start = { x: 350, y: 330 }, goal = { x: 780, y: 330 };
const path = g.findPath(start, goal, 10);
ok(path.length >= 3, 'unit must route around the central building');
let last = start;
for (const waypoint of path) { ok(!g.lineBlocked(last, waypoint, 10), 'every path segment must clear padded walls'); last = waypoint; }
const moving = { ...start };
for (let i=0; i<300; i++) { g.moveAlongPath(moving, goal, 100, .11, 10); ok(!g.pointBlocked(moving.x,moving.y,10), 'large frame step must never enter wall'); }
ok(Math.hypot(moving.x-goal.x,moving.y-goal.y)<1, 'unit should reach far side');
// Compare collisions in flight order, including thin walls and the last lifetime fraction.
function shotScene(wall, enemy) {
 g.zombies.length=0; g.bullets.length=0;
 g.setCustom([wall]);
 g.zombies.push({ x: enemy, y:100, r:6, hp:100, alive:true });
 g.bullets.push({ x:120,y:100,vx:1000,vy:0,damage:30,life:.3,type:1 });
}
shotScene({x:200,y:80,w:16,h:40},250); g.updateBullets(.2);
ok(g.zombies[0].hp === 100 && g.bullets[0].life === 0 && g.bullets[0].x === 200,'wall must stop a fast bullet before an enemy behind it');
shotScene({x:200,y:80,w:16,h:40},170); g.updateBullets(.2);
ok(g.zombies[0].hp === 70 && g.bullets[0].x < 200,'enemy before wall must receive damage first');
shotScene({x:145,y:80,w:16,h:40},180); g.bullets[0].life=.03; g.updateBullets(.11);
ok(g.bullets[0].x === 145 && g.zombies[0].hp === 100,'expiring bullet must still sweep its remaining distance');
// Invalid custom imports cannot trap units inside the core or inject malformed geometry.
g.applyMap('custom');
for (const invalid of [[{x:420,y:260,w:30,h:30}], [{x:120,y:80,w:-1,h:30}], [{x:NaN,y:80,w:30,h:30}], {foo:[]}]) {
 assert.throws(() => g.validateCustomMap(invalid)); checks++;
}
// The detailed nest blueprints keep their rooms, bridges, and supply points reachable.
for (const map of ['labyrinth', 'chambers', 'river']) {
  g.setMission('destroy'); g.applyMap(map); g.resetGame();
  const entry = g.MAPS[map].entry;
  for (const target of [...g.searchSites(), ...g.supplyPoints()]) ok(g.findPath(entry, target, 8).length > 0, `${map}: target must be reachable from the entry`);
}
g.applyMap('river');
const river = g.MAPS.river;
ok(g.lineBlocked({x:450,y:100},{x:650,y:100},8), 'river water blocks movement');
ok(!g.sightBlocked({x:450,y:100},{x:650,y:100}), 'river water permits ballistic sight');
const slit = river.obstacles.find(r => r.kind === 'slit');
if (slit) ok(g.lineBlocked({x:slit.x-30,y:slit.y+slit.h/2},{x:slit.x+slit.w+30,y:slit.y+slit.h/2},2), 'firing slit blocks movement');
g.setAmmoMode('finite'); g.survivors.length = 0; g.survivors.push({x:800,y:400,type:1,ammo:2,alive:true,id:1,homeX:800,homeY:400,replan:0});
const supplyGoal = g.supplyPoints()[0]; const refill = g.handleSupply(g.survivors[0], 2.1);
ok(g.survivors[0].resupplying && refill, 'low-ammo unit should select a supply route');
g.survivors[0].x = supplyGoal.x; g.survivors[0].y = supplyGoal.y; g.survivors[0].supplyGoal = supplyGoal; g.handleSupply(g.survivors[0], 2.1);
ok(g.survivors[0].ammo === 72 && !g.survivors[0].resupplying, 'unit should refill after two seconds at a supply point');
// Infection is immediate and a newborn cannot infect additional units on its birth frame.
g.applyMap('ridge'); g.resetGame(); g.survivors.length=0; g.zombies.length=0;
for (let i=0;i<2;i++) g.survivors.push({x:140+i*6,y:330,type:1,alive:true,id:i,hp:100,homeX:140+i*6,homeY:330,replan:10,cooldown:999,planX:140+i*6,planY:330});
g.zombies.push({x:140,y:330,r:6,hp:100,alive:true,hit:0,speed:0,damage:1,id:9});
g.update(.01);
ok(g.survivors.filter(s=>s.alive).length===1 && g.zombies.length===2,'one contact should convert exactly one human this frame');
// Model choices follow observable targets; no invisible horde or unrelated low absolute squad count.
g.setMission('destroy');
const calm={survivors:4,visible_zombies:0,squad_in_contact_danger:0,mother_core_visible:false};
ok(g.availableActions(calm).join(',')==='SCOUT','unseen enemies must not enable suppression');
ok(g.applyMissionTactics('SUPPRESS',calm).posture==='SCOUT','stale suppression with no target should return to search');
ok(g.applyMissionTactics('SCOUT',calm).posture==='SCOUT','a valid model order must be preserved for small squads');
ok(g.availableActions({...calm,mother_core_visible:true}).includes('ASSAULT'),'discovery must enable assault and remove search');
ok(!g.availableActions({...calm,mother_core_visible:true}).includes('SCOUT'),'do not search after discovery');
ok(!g.availableActions({...calm,visible_zombies:5,last_posture:'SUPPRESS',seconds_in_current_action:12,kills_in_current_action:0,squad_moved_in_current_action:0}).includes('SUPPRESS'),'stationary ineffective suppression must yield a new actionable plan');
// Difficulty affects actual unit count, spawn count and hit points, including an empty sandbox.
g.setMission('destroy');g.applyMap('ridge');Object.assign(g.difficulty,{humans:36,zombies:17,hp:90,spawn:0});g.resetGame();g.beginWave();
ok(g.survivors.length===36,'human count setting should spawn exactly 36 humans');
ok(g.survivors.filter(s=>s.type===0).length===8&&g.survivors.filter(s=>s.type===1).length===12&&g.survivors.filter(s=>s.type===2).length===8&&g.survivors.filter(s=>s.type===3).length===8,'difficulty should preserve the machine/rifle/sniper/shotgun squad ratio');
ok(g.zombies.length===17,'zombie count setting should spawn exactly 17 zombies');
ok(g.zombies.every(z=>z.hp===Math.round(90*(z.elite?1.65:1))),'health setting must apply to every actual zombie');
g.zombies.length=0;g.update(3);ok(!g.zombies.length,'zero reinforcement rate must not create zombies');
// Compare real target assignment and resulting movement between suppression and flanking.
Object.assign(g.difficulty,{humans:18,zombies:16,hp:28,spawn:24});g.resetGame();g.setAmmoMode('infinite');
g.survivors.forEach((s,i)=>{s.x=160+(i%4)*8;s.y=300+Math.floor(i/4)*12;s.homeX=s.x;s.homeY=s.y;});
g.zombies.push({x:295,y:350,r:6,hp:10000,maxHp:10000,alive:true,id:555,speed:0,damage:1,hit:0});
g.setPosture('SUPPRESS','test','test');g.update(.01);
ok(g.survivors.every(s=>s.orderTargetId===555),'suppression must assign a single shared visible enemy');
const rifle=g.survivors.find(s=>s.type===1),suppressionGoal={...rifle.orderGoal};
g.setPosture('FLANK','test','test');g.update(.01);
ok(rifle.role==='侧翼包抄'&&g.survivors.find(s=>s.type===0).role==='正面掩护','flank order must split mobile units from covering weapons');
ok(Math.hypot(rifle.orderGoal.x-suppressionGoal.x,rifle.orderGoal.y-suppressionGoal.y)>30,'flank order must materially change actual movement destinations');
const before={x:rifle.x,y:rifle.y};for(let i=0;i<30;i++)g.update(.03);
ok(Math.hypot(rifle.x-before.x,rifle.y-before.y)>20,'flanking unit must move along its assigned route');
// Search gives different rooms to the two mobile teams; regroup cancels forward exploration.
g.setMission('destroy');g.applyMap('labyrinth');g.resetGame();g.setPosture('SCOUT','test','test');g.update(.01);
const rifleGoal=g.survivors.find(s=>s.type===1).orderGoal,shotgunGoal=g.survivors.find(s=>s.type===3).orderGoal;
ok(Math.hypot(rifleGoal.x-shotgunGoal.x,rifleGoal.y-shotgunGoal.y)>40,'search teams must visit distinct rooms');
g.setPosture('REGROUP','test','test');g.update(.01);
ok(g.survivors.every(s=>s.role.includes('集合')),'regroup must redirect every unit away from exploration');
// Mother rendering is independent of the small hitbox and never drawn while undiscovered.
let arcs=0;box.document.querySelector('#arena').getContext().arc=()=>arcs++;
g.drawMotherMarker();ok(arcs===0,'undiscovered mother must not leak a marker');
g.revealMother({x:919,y:143,r:9});g.drawMotherMarker();ok(arcs>=3,'discovered mother must render a large ring plus a visible core');
// Run twelve scenario combinations with normal simulation updates and inspect every unit.
const began=performance.now();
for (const mission of ['protect','destroy']) for (const map of ['ridge','crossroads','foundry','labyrinth','chambers','river']) {
 g.setMission(mission); g.applyMap(map); g.resetGame(); g.setWave(1,0);
 for(let frame=0;frame<180;frame++) {
  g.update(1/30);
  for(const unit of [...g.survivors.filter(s=>s.alive),...g.zombies]) assert(!g.pointBlocked(unit.x,unit.y,unit.r || 5), `${mission}/${map}: unit in obstacle`);
 }
 checks++;
 console.log(`${mission}/${map}: humans=${g.survivors.filter(s=>s.alive).length}, zombies=${g.zombies.length}, core=${Math.round(g.coreHP())}`);
}
// The last defense wave must eventually stop spawning and permit a real victory.
g.setMission('protect'); g.applyMap('ridge'); g.resetGame(); g.setWave(6,44); g.update(.01);
ok(g.isOver(), 'cleared final wave must complete defense');
console.log(`PASS: ${checks} assertions; scenario simulation ${Math.round(performance.now()-began)} ms`);

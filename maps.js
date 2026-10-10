// All coordinates use the same world space as the arena. Openings are real gaps.
(() => {
  const rect = (x,y,w,h,extra={}) => ({x,y,w,h,...extra});
  function vertical(x,y,h,gaps=[]) {
    const result=[]; let cursor=y;
    for(const [from,to,slit=false] of gaps.sort((a,b)=>a[0]-b[0])) {
      if(from>cursor) result.push(rect(x,cursor,14,from-cursor));
      if(slit) result.push(rect(x,from,14,to-from,{movementOnly:true,kind:'slit'}));
      cursor=to;
    }
    if(cursor<y+h)result.push(rect(x,cursor,14,y+h-cursor));
    return result;
  }
  function horizontal(x,y,w,gaps=[]) {
    return vertical(y,x,w,gaps).map(r=>rect(r.y,r.x,r.h,r.w,{...(r.movementOnly?{movementOnly:true,kind:'slit'}:{})}));
  }
  function room(x,y,w,h,doors={}) {
    return [...horizontal(x,y,w,doors.n||[]),...horizontal(x,y+h-14,w,doors.s||[]),...vertical(x,y,h,doors.w||[]),...vertical(x+w-14,y,h,doors.e||[])];
  }
  const seed={x:146,y:468,w:76,h:64}, entry={x:164,y:333};
  globalThis.NEST_MAPS = {
    labyrinth: {
      title:'回声迷宫',subtitle:'环形巢穴 · 假岔路 · 射击孔',core:seed,entry,
      nest:{x:270,y:80,w:720,h:510},
      obstacles:[...room(270,80,720,510,{w:[[300,378]]}),
        ...vertical(500,94,482,[[175,233],[278,286,true],[425,483]]),
        ...horizontal(284,350,216,[[375,433]]),
        ...horizontal(514,330,462,[[700,764],[830,838,true]]),
        ...vertical(750,94,236,[[180,240]]),
        rect(354,135,14,120),rect(365,241,65,14),rect(596,389,14,115),rect(610,490,65,14),
        ...vertical(820,344,232,[[447,507]])],
      rooms:[{x:300,y:110,w:180,h:210,label:'外廊'},{x:520,y:110,w:205,h:200,label:'孵化室 A'},{x:770,y:110,w:185,h:200,label:'档案室'}, {x:295,y:375,w:180,h:190,label:'旧仓库'},{x:525,y:355,w:275,h:205,label:'孵化室 B'},{x:840,y:360,w:115,h:200,label:'深层巢室'}],
      searchSites:[{x:424,y:180},{x:411,y:456},{x:630,y:175},{x:688,y:423},{x:888,y:183},{x:913,y:468}],
      motherCandidates:[{x:919,y:143},{x:923,y:533},{x:632,y:134}],
      supplies:[{x:170,y:400},{x:410,y:460},{x:680,y:530}],
    },
    chambers: {
      title:'蜂巢地堡',subtitle:'六间密室 · 窄廊连接 · 交叉火力',core:seed,entry,
      nest:{x:280,y:88,w:700,h:510},
      obstacles:[...room(280,88,210,210,{w:[[235,289]],s:[[365,425]],e:[[168,176,true]]}),
        ...room(280,358,210,235,{w:[[453,511]],n:[[365,425]],e:[[450,510]]}),
        ...room(550,88,185,210,{w:[[215,273]],s:[[610,672]]}),
        ...room(550,358,185,235,{w:[[450,510]],n:[[610,672]],e:[[450,510]]}),
        ...room(795,88,185,210,{w:[[215,273]],s:[[845,907]]}),
        ...room(795,358,185,235,{w:[[450,510]],n:[[845,907]],e:[[450,458,true]]}),
        ...horizontal(490,438,60),...horizontal(490,510,60),
        ...horizontal(735,438,60),...horizontal(735,510,60),
        ...vertical(353,298,60),...vertical(425,298,60),
        ...vertical(598,298,60),...vertical(672,298,60),
        ...vertical(833,298,60),...vertical(907,298,60),
        rect(575,155,50,24),rect(853,404,30,60)],
      rooms:[{x:294,y:102,w:182,h:182,label:'净化室'},{x:294,y:372,w:182,h:207,label:'泵房'}, {x:564,y:102,w:157,h:182,label:'孵化室'}, {x:564,y:372,w:157,h:207,label:'连接大厅'}, {x:809,y:102,w:157,h:182,label:'密封库'}, {x:809,y:372,w:157,h:207,label:'母巢候选区'}],
      searchSites:[{x:391,y:222},{x:394,y:465},{x:638,y:469},{x:638,y:220},{x:889,y:475},{x:887,y:198}],
      motherCandidates:[{x:924,y:146},{x:930,y:548},{x:450,y:147}],
      supplies:[{x:170,y:400},{x:410,y:550},{x:639,y:550}],
    },
    river: {
      title:'黑水河谷',subtitle:'双桥渡河 · 河岸火力 · 东岸密室',core:seed,entry,
      nest:{x:658,y:82,w:338,h:518},
      water:{x:492,y:46,w:116,h:592},bridges:[{x:492,y:179,w:116,h:62},{x:492,y:460,w:116,h:68}],
      obstacles:[rect(492,46,116,133,{movementOnly:true,kind:'water'}),rect(492,241,116,219,{movementOnly:true,kind:'water'}),rect(492,528,116,110,{movementOnly:true,kind:'water'}),
        ...room(260,116,185,195,{w:[[207,265]],e:[[198,252]],s:[[345,353,true]]}),
        ...room(260,383,185,190,{w:[[453,515]],e:[[457,523]]}),
        ...room(668,85,316,236,{w:[[182,244]],s:[[795,855]],e:[[185,193,true]]}),
        ...room(668,371,316,224,{w:[[458,528]],n:[[795,855]]}),
        ...vertical(790,99,208,[[175,233]]),...vertical(810,385,196,[[464,522]]),
        rect(722,458,36,40),rect(902,259,42,24)],
      rooms:[{x:274,y:130,w:155,h:160,label:'西岸哨所'},{x:275,y:397,w:155,h:155,label:'物资站'}, {x:685,y:103,w:90,h:196,label:'闸门间'},{x:811,y:103,w:154,h:196,label:'上层巢室'}, {x:686,y:389,w:104,h:184,label:'下层外廊'},{x:829,y:390,w:137,h:184,label:'深水巢室'}],
      searchSites:[{x:355,y:211},{x:355,y:486},{x:715,y:213},{x:713,y:515},{x:876,y:197},{x:889,y:479}],
      motherCandidates:[{x:931,y:147},{x:927,y:551}],
      supplies:[{x:166,y:400},{x:351,y:523},{x:636,y:493},{x:852,y:553}],
    },
  };
})();

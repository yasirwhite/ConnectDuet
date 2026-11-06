/* Original ConnectDuet scene. Pure time-based SVG for the OpenDemo renderer.
   No real sessions, credentials, model output or interface recording. */
(() => {
  const C={bg:'#080b18',fg:'#f5f3ff',muted:'#a5adc7',dim:'#626d8e',line:'#303b5d',coral:'#ff9c87',violet:'#b6a0ff',gold:'#f6cb75',teal:'#82dcd1'};
  const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
  const clamp=n=>Math.min(1,Math.max(0,n));
  const ease=n=>1-Math.pow(1-clamp(n),3);
  const text=(x,y,s,size=18,fill=C.fg,weight=400,extra='')=>`<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" font-weight="${weight}" ${extra}>${esc(s)}</text>`;
  const sparkle=(x,y,color,size=18)=>`<g transform="translate(${x} ${y})" stroke="${color}" stroke-width="2.3" stroke-linecap="round">${[0,30,60,90,120,150].map(a=>`<path transform="rotate(${a})" d="M -${size/2} 0 H ${size/2}"/>`).join('')}</g>`;
  const arrow=(x,y,color,direction=1)=>`<path d="M ${x-direction*6} ${y-5} L ${x} ${y} L ${x-direction*6} ${y+5}" stroke="${color}" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
  const cubic=(p,t)=>{
    const u=1-t;return [u*u*u*p[0]+3*u*u*t*p[2]+3*u*t*t*p[4]+t*t*t*p[6],u*u*u*p[1]+3*u*u*t*p[3]+3*u*t*t*p[5]+t*t*t*p[7]];
  };
  const branches=[[720,418,802,418,806,304,888,304],[720,418,804,418,804,444,888,444],[720,418,804,418,804,584,888,584]];
  const path=p=>`M ${p[0]} ${p[1]} C ${p[2]} ${p[3]},${p[4]} ${p[5]},${p[6]} ${p[7]}`;
  const beam=(p,color,opacity=1,width=2)=>`<path d="${path(p)}" fill="none" stroke="${color}" stroke-width="${width}" opacity="${opacity}"/>`;
  const packet=(x,y,color)=>`<circle cx="${x}" cy="${y}" r="11" fill="${color}" opacity=".13"/><circle cx="${x}" cy="${y}" r="4.5" fill="${color}"/><circle cx="${x}" cy="${y}" r="2" fill="#fff"/>`;
  function card({y,title,sub,color,active,kind,tag}){
    return `<g><rect x="888" y="${y}" width="328" height="114" rx="20" fill="url(#card)" stroke="${active?color:C.line}" stroke-opacity="${active?.8:.9}"/>
      <rect x="910" y="${y+23}" width="42" height="42" rx="12" fill="${color}" fill-opacity=".1"/>
      ${kind==='claude'?sparkle(931,y+44,color,23):`<path d="M 922 ${y+36} L 929 ${y+43} L 922 ${y+50} M 933 ${y+50} H 940" fill="none" stroke="${color}" stroke-width="2.4" stroke-linecap="round"/>`}
      ${text(966,y+39,title,21,C.fg,650)}${text(966,y+62,sub,14,C.muted)}
      <circle cx="917" cy="${y+88}" r="3" fill="${active?color:C.dim}"/>
      ${text(929,y+93,tag,12,active?color:C.dim,500,'letter-spacing=".3"')}</g>`;
  }
  function frame(raw){
    const t=Math.max(0,Math.min(11.999,Number(raw)||0));
    const phase=t<2.1?0:t<4.1?1:t<6.1?2:t<8.1?3:t<10.5?4:5;
    const colors=[C.coral,C.violet,C.gold];
    const active=i=>phase===5||phase===4||phase===i+1;
    const phaseStart=[0,2.1,4.1,6.1,8.1,10.5][phase];
    const phaseDur=[2.1,2,2,2,2.4,1.5][phase];
    const progress=clamp((t-phaseStart)/phaseDur);
    const accent=phase===1?C.coral:phase===2?C.violet:phase===3?C.gold:C.teal;
    const captions=[['THE IDEA','One coordinator. Your agents, connected.'],['01 / DELEGATE','“Builder, turn this plan into a first pass.”'],['02 / COLLABORATE','“Reviewer, check the approach.”'],['03 / STEER','“Codex, refine the current implementation.”'],['04 / REPLY','Results return to the coordinating agent.'],['KEEP THE CONVERSATION MOVING','Claude to Claude. Claude to Codex. Back again.']];
    let flowing='';
    if(phase>=1&&phase<=3){
      const p=ease(progress); const color=colors[phase-1];
      flowing+=`<path d="M 324 418 H 450" fill="none" stroke="${color}" stroke-width="2.5"/>`;
      if(p<.32) flowing+=packet(324+126*(p/.32),418,color);
      else {const pt=cubic(branches[phase-1],(p-.32)/.68);flowing+=packet(pt[0],pt[1],color);}
    }
    if(phase===4){
      for(let i=0;i<3;i++){
        const p=clamp((progress-i*.1)/.7);if(p<=0||p>=1)continue;
        if(p<.75){const pt=cubic(branches[i],1-p/.75);flowing+=packet(pt[0],pt[1],colors[i]);}
        else flowing+=packet(450-126*((p-.75)/.25),418,C.teal);
      }
    }
    const initialScale=1.045-.045*ease(t/.85);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720" role="img" aria-labelledby="title desc">
    <title id="title">ConnectDuet: one agent, a whole team</title><desc id="desc">Conceptual overview. A Claude Duet coordinator delegates through ConnectDuet to Claude builder and reviewer sessions using app frontend input, and sends steering to an active Codex session. Replies return to the coordinator. Native delivery requires configured local session routes.</desc>
    <defs><radialGradient id="glow"><stop stop-color="#3b255e" stop-opacity=".48"/><stop offset="1" stop-color="#080b18" stop-opacity="0"/></radialGradient><linearGradient id="card" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#171d34"/><stop offset="1" stop-color="#0f1528"/></linearGradient><linearGradient id="bridge" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#252140"/><stop offset="1" stop-color="#111b31"/></linearGradient><linearGradient id="logo" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${C.coral}"/><stop offset="1" stop-color="${C.violet}"/></linearGradient></defs>
    <style>text{font-family:Segoe UI,Inter,Arial,sans-serif}</style>
    <rect width="1280" height="720" fill="${C.bg}"/><ellipse cx="600" cy="385" rx="670" ry="430" fill="url(#glow)"/>
    <path d="M 48 218 H 1232" stroke="#222941"/>
    <g transform="translate(49 40)"><rect x="0" y="1" width="20" height="20" rx="6" fill="none" stroke="url(#logo)" stroke-width="2.6"/><rect x="13" y="14" width="20" height="20" rx="6" fill="none" stroke="url(#logo)" stroke-width="2.6"/></g>
    ${text(96,68,'ConnectDuet',29,C.fg,700)}
    ${text(1230,63,'ONE COMPUTER. MANY AGENTS.',12,C.muted,600,'text-anchor="end" letter-spacing="2"')}
    <g transform="translate(64 154) scale(${initialScale})">${text(0,0,'One agent. A whole team.',46,C.fg,700,'letter-spacing="-1.5"')}</g>
    ${text(64,192,'Claude Duet delegates. Claude and Codex stay in the conversation.',19,C.muted)}
    <path d="M 324 418 H 450" stroke="${phase===4||phase===5?C.teal:C.line}" stroke-width="2" fill="none"/>
    ${branches.map((p,i)=>beam(p,active(i)?colors[i]:C.line,active(i)?.85:1,active(i)?2.2:1.8)+arrow(883,p[7],active(i)?colors[i]:C.dim)).join('')}
    ${arrow(445,418,phase===0?C.dim:accent)}
    <g><rect x="64" y="307" width="260" height="222" rx="24" fill="url(#card)" stroke="${phase===4||phase===5?C.teal:'#43405c'}"/>
      <rect x="86" y="330" width="44" height="44" rx="13" fill="${C.coral}" fill-opacity=".12"/>${sparkle(108,352,C.coral,25)}
      ${text(144,346,'YOUR COORDINATOR',10,C.muted,600,'letter-spacing="1.5"')}${text(144,371,'Claude Duet',23,C.fg,650)}
      ${text(86,415,'“Build it. Review it.',19,C.fg,450)}${text(86,444,'Then bring it together.”',19,C.fg,450)}
      <rect x="86" y="470" width="216" height="34" rx="9" fill="${phase>=4?C.teal:C.violet}" fill-opacity=".08"/>
      <circle cx="102" cy="487" r="3.5" fill="${phase>=4?C.teal:C.violet}"/>
      ${text(114,492,phase>=4?'Replies in context':'Delegates by agent name',12,phase>=4?C.teal:C.violet,500)}</g>
    <g><rect x="450" y="347" width="270" height="148" rx="24" fill="url(#bridge)" stroke="${phase?accent:'#73628f'}" stroke-opacity=".8"/>
      <path d="M 475 377 H 493 Q 503 377 503 387 V 397 M 503 377 H 521 Q 531 377 531 387 V 397" fill="none" stroke="${C.violet}" stroke-width="2" stroke-linecap="round"/>
      <circle cx="475" cy="377" r="3" fill="${C.coral}"/><circle cx="503" cy="397" r="3" fill="${C.violet}"/><circle cx="531" cy="397" r="3" fill="${C.gold}"/>
      ${text(475,435,'ConnectDuet',27,C.fg,700)}${text(475,465,'Discover  ·  Send  ·  Reply',14,C.muted)}</g>
    ${card({y:247,title:'Claude · Builder',sub:'Message enters the app frontend',color:C.coral,active:active(0),kind:'claude',tag:'FRIENDLY CLAUDE SESSION'})}
    ${card({y:387,title:'Claude · Reviewer',sub:'Message enters the app frontend',color:C.violet,active:active(1),kind:'claude',tag:'FRIENDLY CLAUDE SESSION'})}
    ${card({y:527,title:'Codex · Implementer',sub:'Steers the selected active session',color:C.gold,active:active(2),kind:'codex',tag:'DIRECT SESSION STEERING'})}
    ${flowing}
    ${text(64,578,captions[phase][0],11,accent,700,'letter-spacing="1.8"')}
    ${text(64,613,captions[phase][1],20,C.fg,500)}
    ${text(64,685,'CONCEPTUAL OVERVIEW  ·  Native delivery uses configured local session routes.',12,C.dim,500)}
    <rect x="64" y="650" width="656" height="2" rx="1" fill="#232b44"/><rect x="64" y="650" width="${656*t/12}" height="2" rx="1" fill="${accent}"/>
    </svg>`;
  }
  globalThis.ConnectDuetScene={frame};
})();

const paths: Record<string, string> = {
    grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    people: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.87"/><circle cx="9" cy="7" r="4"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    bag: '<path d="M5 7h14l2 14H3L5 7Z"/><path d="M8 7V5a4 4 0 0 1 8 0v2"/>',
    book: '<path d="M4 3h14a2 2 0 0 1 2 2v16H6a3 3 0 0 1 0-6h14M4 3v15"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
    arrow: '<path d="M7 17 17 7M7 7h10v10"/>',
    right: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    fork: '<circle cx="6" cy="4" r="2"/><circle cx="18" cy="4" r="2"/><circle cx="6" cy="20" r="2"/><path d="M6 6v12m12-12v3a5 5 0 0 1-5 5H6"/>',
    message: '<path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    shield: '<path d="m12 3 8 4v6c0 5-8 8-8 8s-8-3-8-8V7l8-4Z"/><path d="m8 12 3 3 5-6"/>',
    lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2"/>',
    refresh: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 7a7 7 0 0 1 12-2l2 2M4 17l2 2a7 7 0 0 0 12-2"/>',
    code: '<path d="m8 7-5 5 5 5m8-10 5 5-5 5M14 4l-4 16"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1"/>',
    wallet: '<path d="M20 8V5a2 2 0 0 0-2-2H5a3 3 0 0 0 0 6h15v12H5a3 3 0 0 1-3-3V6"/><path d="M20 12h-5v5h5"/>',
    leaf: '<path d="M20 3c-9-1-17 2-16 10a6 6 0 0 0 10 5c4-3 5-9 6-15Z"/><path d="M4 21 15 9"/>',
};
export const icon = (name: string) => `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] ?? paths.grid}</svg>`;
export const mark = '<svg viewBox="0 0 48 48" fill="none" aria-hidden="true"><path d="M9 39V21a15 15 0 0 1 30 0v18M17 39V21a7 7 0 0 1 14 0v18M9 30h30" stroke="currentColor" stroke-width="4"/></svg>';
export const garden = `<svg class="garden" viewBox="0 0 520 350" fill="none" aria-label="A strategy idea passes through a risk guard before an action" role="img">
<defs><pattern id="dots" width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="#c9cdc0"/></pattern></defs>
<rect x="2" y="2" width="516" height="346" rx="12" fill="#e9eee2"/><rect x="2" y="2" width="516" height="346" rx="12" fill="url(#dots)"/>
<path d="M58 286c84-94 110 19 181-51s92-25 126-110 86-46 108-91" stroke="#9da98d" stroke-width="1.5" stroke-dasharray="4 5"/>
<path d="M146 115v32c0 14 14 14 30 14h82c15 0 20 6 20 21v33m0 61v25" stroke="#556d4b" stroke-width="2"/>
<rect x="49" y="55" width="194" height="65" rx="8" fill="#fffdf7" stroke="#bbc5ae"/><circle cx="73" cy="79" r="5" fill="#e85e35"/>
<text x="88" y="83" fill="#34412e" font-family="monospace" font-size="11">01 / THE IDEA</text><text x="69" y="105" fill="#253522" font-family="Georgia" font-size="16">A signal worth exploring.</text>
<rect x="182" y="178" width="196" height="69" rx="8" fill="#314d39"/><path d="m205 197 7 3v6c0 4-7 7-7 7s-7-3-7-7v-6l7-3Z" stroke="#c3d2b6"/>
<text x="220" y="207" fill="#d6e0ce" font-family="monospace" font-size="10">02 / THE GUARD</text><text x="201" y="232" fill="#fffdf7" font-family="Georgia" font-size="16">Risk comes before action.</text>
<rect x="288" y="278" width="194" height="49" rx="8" fill="#fffdf7" stroke="#bbc5ae"/><circle cx="307" cy="302" r="5" fill="#6e875e"/><text x="323" y="307" fill="#253522" font-family="monospace" font-size="11">03 / A CLEAR INTENT</text>
<path d="M320 102c0-17 13-25 25-25 2 17-7 29-25 25Zm0 0c0-16-13-24-25-24-1 16 7 28 25 24Zm0 0v30" stroke="#68815b" stroke-width="2"/>
<text x="40" y="320" fill="#68735f" font-family="monospace" font-size="9">GOOD IDEAS NEED GOOD ROOTS.</text>
</svg>`;

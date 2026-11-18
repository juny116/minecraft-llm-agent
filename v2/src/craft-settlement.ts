import type {Bot} from 'mineflayer';
// A completed click is not an authoritative inventory acknowledgement on modern
// protocols. Mineflayer's resync requests a full server window snapshot.
async function sync(bot:Bot, window:any){
 const b=bot as any;
 if(!b._syncWindow) { if(b._client)throw Error('Inventory resynchronization unavailable'); return; }
 let timer:ReturnType<typeof setTimeout>|undefined;
 try {await Promise.race([b._syncWindow(window),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('Inventory settlement acknowledgement timed out')),5000);})]);}
 finally {clearTimeout(timer);}
}
export async function settleCraftInventory(bot:Bot){
 const b=bot as any,window=b.currentWindow??b.inventory;
 await sync(bot,window);
 // This cleanup is part of the in-flight transaction even after cancellation.
 // Never take the result slot here: that would perform another recipe.
 if(window.selectedItem){await b.putSelectedItemRange(window.inventoryStart,window.inventoryEnd,window,null);await sync(bot,window);}
 const end=window===b.inventory?4:window.type?.startsWith('minecraft:crafting')?9:0;
 for(let slot=1;slot<=end;slot++)if(window.slots?.[slot]){await b.putAway(slot);await sync(bot,window);}
 if(window.selectedItem||Array.from({length:end},(_,i)=>window.slots?.[i+1]).some(Boolean))throw Error('Craft inventory settlement incomplete; grid/cursor items remain');
}

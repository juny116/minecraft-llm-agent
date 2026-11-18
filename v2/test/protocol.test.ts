import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { protocolOverrides } from '../src/protocol.js';
const require=createRequire(import.meta.url);
const req=createRequire(require.resolve('mineflayer'));

test('Java 1.21.1 recipe id 22 decodes as decorated pot and consumes the entire packet',()=>{
 const name=Buffer.from('minecraft:decorated_pot');
 // Server protocol 767: packet 0x77, one recipe, serializer 22, category 3.
 const packet=Buffer.concat([Buffer.from([0x77,1,name.length]),name,Buffer.from([22,3])]);
 const {createDeserializer}=req('minecraft-protocol/src/transforms/serializer');
 const parser=createDeserializer({state:'play',version:'1.21.1',customPackets:protocolOverrides('1.21.1')});
 const decoded=parser.parsePacketBuffer(packet);
 assert.equal(decoded.metadata.size,packet.length);
 const recipe=decoded.data.params.recipes[0];
 assert.equal(recipe.type,'minecraft:crafting_decorated_pot');
 assert.equal(recipe.data.category,3);
});

test('recipe override does not change other Minecraft versions',()=>{
 assert.equal(protocolOverrides('1.21.4'),undefined);
});

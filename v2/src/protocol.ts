import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const mineflayerRequire = createRequire(require.resolve('mineflayer'));

// minecraft-data 3.117.0 incorrectly retains removed banneraddpattern serializer
// in Java 1.21.1. All IDs after 10 are shifted; decorated_pot (22) becomes trim.
// Keep this compatibility override version-specific and fail on unexpected schemas.
export function protocolOverrides(version: string): Record<string, unknown> | undefined {
  if (version !== '1.21.1') return undefined;
  const data = mineflayerRequire('minecraft-data')(version);
  const recipePacket = structuredClone(data.protocol.play.toClient.types.packet_declare_recipes);
  const mapping = recipePacket[1][0].type[1].type[1][1].type[1].mappings;
  if (mapping[11] !== 'minecraft:crafting_special_banneraddpattern') return undefined;
  if (mapping[23] !== 'minecraft:crafting_decorated_pot') throw new Error('Unexpected recipe serializer schema');
  delete mapping[11];
  for (let id = 12; id <= 23; id++) { mapping[id - 1] = mapping[id]; delete mapping[id]; }
  return { '1.21': { play: { toClient: { types: { packet_declare_recipes: recipePacket } } } } };
}

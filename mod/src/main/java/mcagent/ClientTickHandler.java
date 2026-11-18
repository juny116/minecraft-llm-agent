package mcagent;

import com.google.gson.Gson;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;

import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.screens.ConnectScreen;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.gui.screens.TitleScreen;
import net.minecraft.client.multiplayer.ServerData;
import net.minecraft.client.multiplayer.resolver.ServerAddress;
import net.minecraft.client.player.Input;
import net.minecraft.client.player.KeyboardInput;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.core.RegistryAccess;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.util.Mth;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.InteractionResult;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.player.Inventory;
import net.minecraft.world.inventory.AbstractContainerMenu;
import net.minecraft.world.inventory.ClickType;
import net.minecraft.world.inventory.RecipeBookMenu;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.crafting.Ingredient;
import net.minecraft.world.item.crafting.Recipe;
import net.minecraft.world.item.crafting.RecipeHolder;
import net.minecraft.world.item.crafting.RecipeManager;
import net.minecraft.world.item.crafting.RecipeType;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.phys.AABB;
import net.minecraft.world.phys.BlockHitResult;
import net.minecraft.world.phys.EntityHitResult;
import net.minecraft.world.phys.HitResult;
import net.minecraft.world.phys.Vec3;
import net.neoforged.neoforge.client.event.ClientChatReceivedEvent;
import net.neoforged.neoforge.client.event.ClientTickEvent;

/**
 * Runs on the client thread. Drains queued commands, drives the local player,
 * and publishes a fresh state snapshot every tick.
 */
public final class ClientTickHandler {
    private static final Gson GSON = new Gson();

    /** Our controllable input. Base {@link Input#tick} is a no-op, so the values
     *  we set here are NOT overwritten by the keyboard each tick. */
    private static final Input BOT_INPUT = new Input();

    // ---- persistent control state (client thread only) ----
    private static volatile boolean enabled = false;
    private static float forward = 0f;   // +1 forward, -1 back
    private static float strafe = 0f;    // +1 left, -1 right
    private static boolean jumpHeld = false;
    private static boolean sneakHeld = false;
    private static boolean sprintHeld = false;
    private static boolean miningHeld = false;
    private static int jumpPulse = 0;
    private static BlockPos lastMinePos = null;
    /** When set, the bot auto-aims at this exact block and breaks it (reliable
     *  harvesting — no controller-side aim jitter). Cleared when it turns to air. */
    private static BlockPos mineTarget = null;

    /** Headless auto-connect: when JVM is started with -Dmcagent.autoConnect=host:port,
     *  fire a single connection attempt once the title screen is up (no GUI to click). */
    private static final String AUTO_CONNECT = System.getProperty("mcagent.autoConnect");
    private static boolean autoConnectFired = false;

    /** Recently received in-game chat (newest last), exposed in the snapshot so the
     *  controller can react. Arrives on the network thread, read on the client thread. */
    private static final java.util.concurrent.ConcurrentLinkedDeque<String> CHAT =
            new java.util.concurrent.ConcurrentLinkedDeque<>();
    private static final int CHAT_MAX = 12;

    public static void onClientChat(ClientChatReceivedEvent event) {
        try {
            String msg = event.getMessage().getString();
            if (msg != null && !msg.isBlank()) {
                CHAT.addLast(msg);
                while (CHAT.size() > CHAT_MAX) CHAT.pollFirst();
            }
        } catch (Exception ignored) {
        }
    }

    public static void onClientTickPre(ClientTickEvent.Pre event) {
        Minecraft mc = Minecraft.getInstance();
        LocalPlayer player = mc.player;

        // Apply queued commands (main thread, safe to touch MC objects).
        JsonObject cmd;
        while ((cmd = BotControl.INSTANCE.inbox.poll()) != null) {
            try {
                applyCommand(mc, player, cmd);
            } catch (Exception e) {
                McAgentMod.LOGGER.warn("[mcagent] command failed: {}", e.toString());
            }
        }

        // Headless auto-connect: once at the title screen, dial the configured server.
        if (AUTO_CONNECT != null && !autoConnectFired
                && player == null && mc.level == null && mc.screen instanceof TitleScreen) {
            autoConnectFired = true;
            try {
                connectTo(mc, AUTO_CONNECT);
            } catch (Exception e) {
                McAgentMod.LOGGER.warn("[mcagent] autoConnect failed: {}", e.toString());
            }
        }

        if (player == null) return;

        // When Baritone is driving (pathing/following), hand off control: restore the
        // normal keyboard input so Baritone's input override works, and don't fight it.
        boolean baritoneActive = baritoneActive();

        if (enabled && !baritoneActive) {
            if (player.input != BOT_INPUT) {
                player.input = BOT_INPUT;
            }
            boolean jumping = jumpHeld;
            if (jumpPulse > 0) { jumping = true; jumpPulse--; }
            BOT_INPUT.forwardImpulse = forward;
            BOT_INPUT.leftImpulse = strafe;
            BOT_INPUT.up = forward > 0;
            BOT_INPUT.down = forward < 0;
            BOT_INPUT.left = strafe > 0;
            BOT_INPUT.right = strafe < 0;
            BOT_INPUT.jumping = jumping;
            BOT_INPUT.shiftKeyDown = sneakHeld;
            player.setSprinting(sprintHeld && forward > 0);
            if (mineTarget != null) handleMineTarget(mc, player);
            else handleMining(mc, player);
        } else {
            if (player.input == BOT_INPUT) {
                player.input = new KeyboardInput(mc.options);
            }
            if (lastMinePos != null) {
                mc.gameMode.stopDestroyBlock();
                lastMinePos = null;
            }
        }
    }

    public static void onClientTickPost(ClientTickEvent.Post event) {
        Minecraft mc = Minecraft.getInstance();
        LocalPlayer player = mc.player;
        if (player == null || mc.level == null) {
            BotControl.INSTANCE.snapshot = "{\"ready\":false}";
            return;
        }
        try {
            BotControl.INSTANCE.snapshot = buildSnapshot(mc, player);
        } catch (Exception e) {
            // keep last good snapshot
        }
    }

    // ---------------------------------------------------------------- commands

    private static void applyCommand(Minecraft mc, LocalPlayer player, JsonObject c) {
        String type = c.has("type") ? c.get("type").getAsString() : "";
        switch (type) {
            case "connect": {
                String host = c.has("host") ? c.get("host").getAsString() : "127.0.0.1";
                int port = c.has("port") ? c.get("port").getAsInt() : 25565;
                connectTo(mc, host + ":" + port);
                break;
            }
            case "enable":
                enabled = getBool(c, "on", true);
                break;
            case "disable":
                enabled = false;
                break;
            case "move":
                forward = getFloat(c, "forward", 0f);
                strafe = getFloat(c, "strafe", 0f);
                break;
            case "stop":
                forward = 0f; strafe = 0f; jumpHeld = false; sprintHeld = false; miningHeld = false; mineTarget = null;
                break;
            case "jump":
                if (c.has("on")) jumpHeld = c.get("on").getAsBoolean();
                else jumpPulse = 3;
                break;
            case "sneak":
                sneakHeld = getBool(c, "on", true);
                break;
            case "sprint":
                sprintHeld = getBool(c, "on", true);
                break;
            case "mine":
                miningHeld = getBool(c, "on", true);
                break;
            case "mine_block":
                if (c.has("x") && c.has("y") && c.has("z")) {
                    mineTarget = new BlockPos(c.get("x").getAsInt(),
                            c.get("y").getAsInt(), c.get("z").getAsInt());
                    miningHeld = false;
                } else {
                    mineTarget = null;   // mine_block with no coords = stop targeting
                }
                break;
            case "use_block":
                // Coordinate-precise right-click (e.g. sleep in a bed, open a door/chest).
                // Mirrors mine_block: aim exactly at the block, no crosshair guesswork.
                if (player != null && c.has("x") && c.has("y") && c.has("z")) {
                    doUseBlock(mc, player, new BlockPos(
                            c.get("x").getAsInt(), c.get("y").getAsInt(), c.get("z").getAsInt()));
                }
                break;
            case "look":
                if (player != null) doLook(player, c);
                break;
            case "select_slot":
                if (player != null && c.has("slot")) {
                    int slot = c.get("slot").getAsInt();
                    if (slot >= 0 && slot <= 8) player.getInventory().selected = slot;
                }
                break;
            case "drop":
                // Discard items so the inventory doesn't soft-lock when full.
                // {"item":"stick"} throws EVERY stack of that item; no item = drop held stack.
                if (player != null) doDrop(mc, player, c);
                break;
            case "store":
                // Deposit items into the chest/container that is CURRENTLY OPEN
                // (open it first with use_block on the chest). {"item":"birch_log"}
                // stores every stack of that item; no item = store the whole inventory.
                if (player != null) doStore(mc, player, c);
                break;
            case "take":
                // Pull items OUT of the open chest/furnace (reverse of store) — needed to
                // retrieve smelted iron_ingot and to withdraw from chests.
                if (player != null) doTake(mc, player, c);
                break;
            case "equip":
                // Move a named item into the hotbar and hold it. select_slot only
                // reaches hotbar 0-8, so items in the main inventory (e.g. a crafting
                // table the bot wants to place) were un-holdable — this fixes that.
                if (player != null && c.has("item")) doEquip(mc, player, c.get("item").getAsString());
                break;
            case "attack":
                if (player != null) doAttack(mc, player);
                break;
            case "use":
                if (player != null) doUse(mc, player);
                break;
            case "goto":
                if (requireBaritone()) {
                    int gx = c.get("x").getAsInt();
                    int gz = c.get("z").getAsInt();
                    if (c.has("y")) BaritoneBridge.gotoBlock(gx, c.get("y").getAsInt(), gz);
                    else BaritoneBridge.gotoXZ(gx, gz);
                }
                break;
            case "goto_near":
                if (requireBaritone()) {
                    int range = c.has("range") ? c.get("range").getAsInt() : 2;
                    BaritoneBridge.gotoNear(c.get("x").getAsInt(), c.get("y").getAsInt(), c.get("z").getAsInt(), range);
                }
                break;
            case "follow":
                if (requireBaritone()) {
                    if (c.has("entityId")) BaritoneBridge.followEntityId(c.get("entityId").getAsInt());
                    else BaritoneBridge.followPlayers();
                }
                break;
            case "cancel":
                if (BaritoneBridge.AVAILABLE) BaritoneBridge.cancel();
                forward = 0f; strafe = 0f; miningHeld = false; mineTarget = null;
                break;
            case "respawn":
                if (player != null) {
                    player.respawn();      // same call the death screen's Respawn button makes
                    mc.setScreen(null);    // dismiss the death screen
                }
                break;
            case "chat":
                if (mc.getConnection() != null && c.has("message")) {
                    String m = c.get("message").getAsString();
                    if (m.startsWith("/")) mc.getConnection().sendCommand(m.substring(1));
                    else mc.getConnection().sendChat(m);
                }
                break;
            case "craft":
                if (player != null && c.has("item")) {
                    doCraft(mc, player, c.get("item").getAsString(),
                            c.has("count") ? c.get("count").getAsInt() : 1);
                }
                break;
            default:
                McAgentMod.LOGGER.warn("[mcagent] unknown command type: '{}'", type);
        }
    }

    /** Connect to a "host:port" server from the menu (headless has no GUI to click join).
     *  Must run on the client/main thread (it is — called from the tick command drain). */
    private static void connectTo(Minecraft mc, String hostPort) {
        if (mc.level != null || mc.player != null) {
            McAgentMod.LOGGER.info("[mcagent] connect ignored: already in a world");
            return;
        }
        ServerAddress addr = ServerAddress.parseString(hostPort);
        ServerData data = new ServerData("mcagent-target", hostPort, ServerData.Type.OTHER);
        Screen parent = mc.screen != null ? mc.screen : new TitleScreen();
        McAgentMod.LOGGER.info("[mcagent] connecting to {}", hostPort);
        ConnectScreen.startConnecting(parent, mc, addr, data, false, null);
    }

    private static void doLook(LocalPlayer player, JsonObject c) {
        float yaw = getFloat(c, "yaw", player.getYRot());
        float pitch = getFloat(c, "pitch", player.getXRot());
        if (c.has("dyaw")) yaw = player.getYRot() + (float) c.get("dyaw").getAsDouble();
        if (c.has("dpitch")) pitch = player.getXRot() + (float) c.get("dpitch").getAsDouble();
        pitch = Math.max(-90f, Math.min(90f, pitch));
        player.setYRot(yaw);
        player.setXRot(pitch);
        player.setYHeadRot(yaw);
        player.setYBodyRot(yaw);
        player.yRotO = yaw;
        player.xRotO = pitch;
    }

    /** Auto-aim at {@link #mineTarget} and break exactly that block. No reliance on
     *  controller aim or mc.hitResult — we know the coords, so we destroy them
     *  directly (reach-checked by the game). Clears the target once it's air. */
    private static void handleMineTarget(Minecraft mc, LocalPlayer player) {
        BlockPos pos = mineTarget;
        if (player.level().getBlockState(pos).isAir()) {   // broken (or already gone)
            mc.gameMode.stopDestroyBlock();
            lastMinePos = null;
            mineTarget = null;
            return;
        }
        double cx = pos.getX() + 0.5, cy = pos.getY() + 0.5, cz = pos.getZ() + 0.5;
        double dx = cx - player.getX(), dy = cy - player.getEyeY(), dz = cz - player.getZ();
        double horiz = Math.sqrt(dx * dx + dz * dz);
        float yaw = (float) (Mth.atan2(dz, dx) * (180.0 / Math.PI)) - 90.0F;
        float pitch = (float) (-(Mth.atan2(dy, horiz) * (180.0 / Math.PI)));
        player.setYRot(yaw);
        player.setXRot(pitch);
        player.yRotO = yaw;
        player.xRotO = pitch;
        Direction face = Direction.getNearest((float) -dx, (float) -dy, (float) -dz);
        if (!pos.equals(lastMinePos)) {
            mc.gameMode.startDestroyBlock(pos, face);
            lastMinePos = pos.immutable();
        } else {
            mc.gameMode.continueDestroyBlock(pos, face);
        }
        player.swing(InteractionHand.MAIN_HAND);
    }

    private static void handleMining(Minecraft mc, LocalPlayer player) {
        if (!miningHeld) {
            if (lastMinePos != null) {
                mc.gameMode.stopDestroyBlock();
                lastMinePos = null;
            }
            return;
        }
        HitResult hr = mc.hitResult;
        if (hr == null || hr.getType() != HitResult.Type.BLOCK) {
            if (lastMinePos != null) {
                mc.gameMode.stopDestroyBlock();
                lastMinePos = null;
            }
            return;
        }
        BlockHitResult bhr = (BlockHitResult) hr;
        BlockPos pos = bhr.getBlockPos();
        Direction dir = bhr.getDirection();
        if (!pos.equals(lastMinePos)) {
            mc.gameMode.startDestroyBlock(pos, dir);
            lastMinePos = pos.immutable();
        } else {
            mc.gameMode.continueDestroyBlock(pos, dir);
        }
        player.swing(InteractionHand.MAIN_HAND);
    }

    private static void doAttack(Minecraft mc, LocalPlayer player) {
        HitResult hr = mc.hitResult;
        if (hr == null) { player.swing(InteractionHand.MAIN_HAND); return; }
        switch (hr.getType()) {
            case ENTITY:
                mc.gameMode.attack(player, ((EntityHitResult) hr).getEntity());
                break;
            case BLOCK:
                BlockHitResult bhr = (BlockHitResult) hr;
                BlockPos p = bhr.getBlockPos();
                if (!player.level().getBlockState(p).isAir()) {
                    mc.gameMode.startDestroyBlock(p, bhr.getDirection());
                }
                break;
            default:
                break;
        }
        player.swing(InteractionHand.MAIN_HAND);
    }

    private static void doUse(Minecraft mc, LocalPlayer player) {
        HitResult hr = mc.hitResult;
        InteractionHand hand = InteractionHand.MAIN_HAND;
        if (hr != null && hr.getType() == HitResult.Type.BLOCK) {
            InteractionResult r = mc.gameMode.useItemOn(player, hand, (BlockHitResult) hr);
            if (r.consumesAction()) { player.swing(hand); return; }
        } else if (hr != null && hr.getType() == HitResult.Type.ENTITY) {
            EntityHitResult ehr = (EntityHitResult) hr;
            InteractionResult r = mc.gameMode.interactAt(player, ehr.getEntity(), ehr, hand);
            if (!r.consumesAction()) r = mc.gameMode.interact(player, ehr.getEntity(), hand);
            if (r.consumesAction()) { player.swing(hand); return; }
        }
        InteractionResult r = mc.gameMode.useItem(player, hand);
        if (r.consumesAction()) player.swing(hand);
    }

    /** Right-click a specific block by coordinate (sleep in bed, open door/chest, etc.).
     *  Aims precisely at the block center (like mine_block) and builds the BlockHitResult
     *  ourselves, so we don't depend on where the crosshair happens to land. */
    private static void doUseBlock(Minecraft mc, LocalPlayer player, BlockPos pos) {
        double cx = pos.getX() + 0.5, cy = pos.getY() + 0.5, cz = pos.getZ() + 0.5;
        double dx = cx - player.getX(), dy = cy - player.getEyeY(), dz = cz - player.getZ();
        double horiz = Math.sqrt(dx * dx + dz * dz);
        float yaw = (float) (Mth.atan2(dz, dx) * (180.0 / Math.PI)) - 90.0F;
        float pitch = (float) (-(Mth.atan2(dy, horiz) * (180.0 / Math.PI)));
        player.setYRot(yaw);
        player.setXRot(pitch);
        player.yRotO = yaw;
        player.xRotO = pitch;
        player.setYHeadRot(yaw);
        // The block face pointing back at the player, with a hit point on the block center.
        Direction face = Direction.getNearest((float) -dx, (float) -dy, (float) -dz);
        BlockHitResult bhr = new BlockHitResult(new Vec3(cx, cy, cz), face, pos, false);
        InteractionHand hand = InteractionHand.MAIN_HAND;
        InteractionResult r = mc.gameMode.useItemOn(player, hand, bhr);
        if (r.consumesAction()) player.swing(hand);
        else mc.gameMode.useItem(player, hand);   // fallback (e.g. item-only use)
    }

    /**
     * Craft an item via the recipe book, like clicking it in the GUI.
     * Uses whatever crafting menu is currently open: the player inventory's 2x2
     * grid is always available (containerMenu defaults to it) for small recipes
     * (planks/sticks/crafting_table/torch); 3x3 recipes (tools) need a crafting
     * table opened first via "use" on a placed table. Crafted result is shift-
     * moved into the inventory. Repeats {@code count} times.
     */
    private static void doCraft(Minecraft mc, LocalPlayer player, String itemId, int count) {
        try {
            AbstractContainerMenu menu = player.containerMenu;
            if (!(menu instanceof RecipeBookMenu)) {
                McAgentMod.LOGGER.info("[mcagent] craft: 크래프팅 메뉴가 아님 (3x3은 제작대 use 먼저)");
                return;
            }
            ResourceLocation target = ResourceLocation.parse(itemId.contains(":") ? itemId : "minecraft:" + itemId);
            RecipeManager rm = mc.getConnection() != null ? mc.getConnection().getRecipeManager() : null;
            if (rm == null) return;
            RegistryAccess ra = player.level().registryAccess();
            // Several recipes can yield the same item (e.g. stick = planks OR bamboo).
            // Pick one whose ingredients the player actually HAS; fall back to the
            // first output match so behaviour is unchanged when we can't tell.
            RecipeHolder<?> found = null;
            for (RecipeHolder<?> h : rm.getRecipes()) {
                if (h.value().getType() != RecipeType.CRAFTING) continue;
                ItemStack out = h.value().getResultItem(ra);
                if (out == null || out.isEmpty()
                        || !BuiltInRegistries.ITEM.getKey(out.getItem()).equals(target)) continue;
                if (playerHasIngredients(player, h.value())) { found = h; break; }
                if (found == null) found = h;   // fallback: first match by output
            }
            if (found == null) {
                McAgentMod.LOGGER.info("[mcagent] craft: 레시피 못 찾음 {}", target);
                return;
            }
            int id = menu.containerId;
            for (int i = 0; i < Math.max(1, count); i++) {
                mc.gameMode.handlePlaceRecipe(id, found, false);   // place ingredients
                mc.gameMode.handleInventoryMouseClick(id, 0, 0, ClickType.QUICK_MOVE, player); // take result
            }
            McAgentMod.LOGGER.info("[mcagent] craft: {} x{} 시도", target, count);
        } catch (Exception e) {
            McAgentMod.LOGGER.warn("[mcagent] craft 실패: {}", e.toString());
        }
    }

    /** Discard items via the player's own inventory menu (no screen needed), so a
     *  full inventory can't soft-lock the bot. {@code {"item":"stick"}} throws every
     *  stack of that item; with no item it drops the currently held (selected) stack.
     *  Uses ClickType.THROW (button 1 = whole stack) which is properly synced to the
     *  server, unlike client-side inventory edits. */
    private static void doDrop(Minecraft mc, LocalPlayer player, JsonObject c) {
        try {
            int containerId = player.inventoryMenu.containerId;
            if (!c.has("item")) {
                player.drop(true);   // throw the entire held stack
                McAgentMod.LOGGER.info("[mcagent] drop: 든 스택 버림");
                return;
            }
            String want = c.get("item").getAsString();
            if (!want.contains(":")) want = "minecraft:" + want;
            Inventory inv = player.getInventory();
            int thrown = 0;
            // Indices 0-8 = hotbar, 9-35 = main. Map to inventoryMenu slots:
            // main 9-35 -> menu 9-35, hotbar 0-8 -> menu 36-44. (armor/offhand 36+ skipped)
            for (int i = 0; i <= 35; i++) {
                ItemStack st = inv.getItem(i);
                if (st.isEmpty()) continue;
                if (!BuiltInRegistries.ITEM.getKey(st.getItem()).toString().equals(want)) continue;
                int menuSlot = (i <= 8) ? 36 + i : i;
                mc.gameMode.handleInventoryMouseClick(containerId, menuSlot, 1, ClickType.THROW, player);
                thrown++;
            }
            McAgentMod.LOGGER.info("[mcagent] drop: {} x{}스택 버림", want, thrown);
        } catch (Exception e) {
            McAgentMod.LOGGER.warn("[mcagent] drop 실패: {}", e.toString());
        }
    }

    /** Hold a named item: if it's already in the hotbar, select it; otherwise swap it
     *  from the main inventory into hotbar slot 0 (ClickType.SWAP = the number-key swap)
     *  and select it. Lets the bot actually hold/place items stuck in the main inventory
     *  (the crafting table it needs to place, tools, food, …). */
    private static void doEquip(Minecraft mc, LocalPlayer player, String item) {
        try {
            if (!item.contains(":")) item = "minecraft:" + item;
            Inventory inv = player.getInventory();
            for (int i = 0; i <= 8; i++) {
                ItemStack st = inv.getItem(i);
                if (!st.isEmpty() && BuiltInRegistries.ITEM.getKey(st.getItem()).toString().equals(item)) {
                    inv.selected = i;
                    McAgentMod.LOGGER.info("[mcagent] equip: {} 핫바 {}번 선택", item, i);
                    return;
                }
            }
            for (int i = 9; i <= 35; i++) {
                ItemStack st = inv.getItem(i);
                if (!st.isEmpty() && BuiltInRegistries.ITEM.getKey(st.getItem()).toString().equals(item)) {
                    int hotbar = 0;   // swap into hotbar slot 0, then hold it
                    mc.gameMode.handleInventoryMouseClick(
                            player.inventoryMenu.containerId, i, hotbar, ClickType.SWAP, player);
                    inv.selected = hotbar;
                    McAgentMod.LOGGER.info("[mcagent] equip: {} 메인{}→핫바{} swap", item, i, hotbar);
                    return;
                }
            }
            McAgentMod.LOGGER.info("[mcagent] equip: {} 인벤에 없음", item);
        } catch (Exception e) {
            McAgentMod.LOGGER.warn("[mcagent] equip 실패: {}", e.toString());
        }
    }

    /** Deposit items into the currently-open container (chest/barrel). The bot must
     *  open the chest first (use_block on it) so {@code containerMenu} becomes that
     *  container's menu. A container menu lays out container slots first, then the 36
     *  player slots; QUICK_MOVE on a player slot ships that stack into the container.
     *  {@code {"item":"birch_log"}} stores every stack of that item; no item stores all. */
    private static void doStore(Minecraft mc, LocalPlayer player, JsonObject c) {
        try {
            AbstractContainerMenu menu = player.containerMenu;
            if (menu == null || menu == player.inventoryMenu) {
                McAgentMod.LOGGER.info("[mcagent] store: 열린 상자가 없음 (먼저 use_block로 상자를 열어)");
                return;
            }
            String want = null;
            if (c.has("item")) {
                want = c.get("item").getAsString();
                if (!want.contains(":")) want = "minecraft:" + want;
            }
            int total = menu.slots.size();
            int playerStart = total - 36;   // container slots come first, then 36 player slots
            if (playerStart < 0) { McAgentMod.LOGGER.info("[mcagent] store: 컨테이너 슬롯 해석 실패"); return; }
            int moved = 0;
            for (int i = playerStart; i < total; i++) {
                ItemStack st = menu.slots.get(i).getItem();
                if (st.isEmpty()) continue;
                if (want != null) {
                    if (!BuiltInRegistries.ITEM.getKey(st.getItem()).toString().equals(want)) continue;
                } else if (st.getMaxDamage() > 0) {
                    // store-all: keep tools/weapons/armor (durability items) so the bot
                    // never banks the pickaxe/axe/sword it just made and stalls progression.
                    continue;
                }
                mc.gameMode.handleInventoryMouseClick(menu.containerId, i, 0, ClickType.QUICK_MOVE, player);
                moved++;
            }
            McAgentMod.LOGGER.info("[mcagent] store: {} x{}스택 보관", want == null ? "(전체)" : want, moved);
        } catch (Exception e) {
            McAgentMod.LOGGER.warn("[mcagent] store 실패: {}", e.toString());
        }
    }

    /** Take items OUT of the currently-open container into the inventory (the reverse of
     *  store). Needed to retrieve smelted iron_ingot from a furnace and to withdraw from
     *  chests — without it the bot could load a furnace but never get the output, so the
     *  whole smelting / iron-tools path was blocked. {@code {"item":"iron_ingot"}} takes
     *  every matching stack; no item takes everything in the container. */
    private static void doTake(Minecraft mc, LocalPlayer player, JsonObject c) {
        try {
            AbstractContainerMenu menu = player.containerMenu;
            if (menu == null || menu == player.inventoryMenu) {
                McAgentMod.LOGGER.info("[mcagent] take: 열린 상자/화로가 없음 (먼저 use_block로 열어)");
                return;
            }
            String want = null;
            if (c.has("item")) {
                want = c.get("item").getAsString();
                if (!want.contains(":")) want = "minecraft:" + want;
            }
            int total = menu.slots.size();
            int playerStart = total - 36;   // container slots = 0..playerStart-1
            if (playerStart < 0) { McAgentMod.LOGGER.info("[mcagent] take: 컨테이너 슬롯 해석 실패"); return; }
            int moved = 0;
            for (int i = 0; i < playerStart; i++) {
                ItemStack st = menu.slots.get(i).getItem();
                if (st.isEmpty()) continue;
                if (want != null && !BuiltInRegistries.ITEM.getKey(st.getItem()).toString().equals(want)) continue;
                mc.gameMode.handleInventoryMouseClick(menu.containerId, i, 0, ClickType.QUICK_MOVE, player);
                moved++;
            }
            McAgentMod.LOGGER.info("[mcagent] take: {} x{}스택 꺼냄", want == null ? "(전체)" : want, moved);
        } catch (Exception e) {
            McAgentMod.LOGGER.warn("[mcagent] take 실패: {}", e.toString());
        }
    }

    /** True if the player's inventory contains at least one item matching every
     *  ingredient of the recipe — used to disambiguate same-output recipes
     *  (e.g. prefer planks→stick over bamboo→stick when only planks are held). */
    private static boolean playerHasIngredients(LocalPlayer player, Recipe<?> recipe) {
        Inventory inv = player.getInventory();
        for (Ingredient ing : recipe.getIngredients()) {
            if (ing.isEmpty()) continue;
            boolean has = false;
            for (int i = 0; i < inv.getContainerSize(); i++) {
                ItemStack st = inv.getItem(i);
                if (!st.isEmpty() && ing.test(st)) { has = true; break; }
            }
            if (!has) return false;
        }
        return true;
    }

    // --------------------------------------------------------------- snapshot

    private static String buildSnapshot(Minecraft mc, LocalPlayer player) {
        JsonObject root = new JsonObject();
        root.addProperty("ready", true);
        root.addProperty("enabled", enabled);
        root.addProperty("name", player.getName().getString());
        root.addProperty("dimension", player.level().dimension().location().toString());
        long timeOfDay = player.level().getDayTime() % 24000L;   // 0~24000 (0=아침,6000=정오,13000~=밤)
        root.addProperty("timeOfDay", timeOfDay);
        root.addProperty("dayCount", player.level().getDayTime() / 24000L);
        root.addProperty("isNight", timeOfDay >= 13000 && timeOfDay < 23000);   // 몹 나오는 밤

        JsonObject pos = new JsonObject();
        pos.addProperty("x", player.getX());
        pos.addProperty("y", player.getY());
        pos.addProperty("z", player.getZ());
        root.add("pos", pos);
        root.addProperty("yaw", player.getYRot());
        root.addProperty("pitch", player.getXRot());
        root.addProperty("onGround", player.onGround());

        Vec3 v = player.getDeltaMovement();
        JsonObject vel = new JsonObject();
        vel.addProperty("x", v.x);
        vel.addProperty("y", v.y);
        vel.addProperty("z", v.z);
        root.add("velocity", vel);

        root.addProperty("health", player.getHealth());
        root.addProperty("maxHealth", player.getMaxHealth());
        root.addProperty("food", player.getFoodData().getFoodLevel());
        root.addProperty("saturation", player.getFoodData().getSaturationLevel());
        root.addProperty("air", player.getAirSupply());
        root.addProperty("xpLevel", player.experienceLevel);

        Inventory inv = player.getInventory();
        root.addProperty("selectedSlot", inv.selected);
        root.add("heldItem", itemJson(player.getMainHandItem()));
        JsonArray items = new JsonArray();
        for (int i = 0; i < 36; i++) {
            ItemStack st = inv.getItem(i);
            if (st.isEmpty()) continue;
            JsonObject ij = itemJson(st);
            ij.addProperty("slot", i);
            items.add(ij);
        }
        root.add("inventory", items);

        root.add("lookingAt", hitResultJson(mc, player));

        JsonArray ents = new JsonArray();
        AABB box = player.getBoundingBox().inflate(16.0);
        for (Entity e : player.level().getEntities(player, box)) {
            JsonObject ej = new JsonObject();
            ej.addProperty("id", e.getId());
            ej.addProperty("type", BuiltInRegistries.ENTITY_TYPE.getKey(e.getType()).toString());
            ej.addProperty("name", e.getName().getString());
            JsonObject ep = new JsonObject();
            ep.addProperty("x", e.getX());
            ep.addProperty("y", e.getY());
            ep.addProperty("z", e.getZ());
            ej.add("pos", ep);
            ej.addProperty("distance", Math.sqrt(player.distanceToSqr(e)));
            ents.add(ej);
        }
        root.add("entities", ents);

        JsonArray blocks = new JsonArray();
        BlockPos base = player.blockPosition();
        int R = 6, cap = 512, count = 0;
        for (int dx = -R; dx <= R && count < cap; dx++)
            for (int dy = -R; dy <= R && count < cap; dy++)
                for (int dz = -R; dz <= R && count < cap; dz++) {
                    BlockPos bp = base.offset(dx, dy, dz);
                    BlockState bs = player.level().getBlockState(bp);
                    if (bs.isAir()) continue;
                    JsonObject bj = new JsonObject();
                    bj.addProperty("x", bp.getX());
                    bj.addProperty("y", bp.getY());
                    bj.addProperty("z", bp.getZ());
                    bj.addProperty("block", BuiltInRegistries.BLOCK.getKey(bs.getBlock()).toString());
                    blocks.add(bj);
                    count++;
                }
        root.add("nearbyBlocks", blocks);
        root.addProperty("blockScanRadius", R);

        // Nearest crafting table within reach — reported explicitly so the controller
        // can reliably open it before a 3x3 craft. (nearbyBlocks is distance-capped and
        // scans west-first, so a table to the east often falls off the 512 cap.)
        BlockPos nearTable = null;
        double nearTableD = 1e9;
        for (int dx = -5; dx <= 5; dx++)
            for (int dy = -4; dy <= 4; dy++)
                for (int dz = -5; dz <= 5; dz++) {
                    BlockPos bp = base.offset(dx, dy, dz);
                    if (!BuiltInRegistries.BLOCK.getKey(player.level().getBlockState(bp).getBlock())
                            .getPath().equals("crafting_table")) continue;
                    double d = dx * dx + dy * dy + dz * dz;
                    if (d < nearTableD) { nearTableD = d; nearTable = bp; }
                }
        if (nearTable != null) {
            JsonObject ct = new JsonObject();
            ct.addProperty("x", nearTable.getX());
            ct.addProperty("y", nearTable.getY());
            ct.addProperty("z", nearTable.getZ());
            root.add("craftingTable", ct);
        }

        // 먼 나무 탐지: 넓은 반경(FR)을 듬성듬성(step) 훑어 통나무/잎 위치만 수집.
        // 봇 지각이 화면 시야보다 좁은 문제 보완 — "저쪽에 나무 있다"를 알려줘 접근하게.
        JsonArray distantTrees = new JsonArray();
        int FR = 48, step = 3, fcap = 30, fcount = 0;
        for (int dx = -FR; dx <= FR && fcount < fcap; dx += step)
            for (int dz = -FR; dz <= FR && fcount < fcap; dz += step)
                for (int dy = -8; dy <= 14 && fcount < fcap; dy += 2) {
                    BlockPos bp = base.offset(dx, dy, dz);
                    String name = BuiltInRegistries.BLOCK.getKey(
                            player.level().getBlockState(bp).getBlock()).getPath();
                    if (name.endsWith("_log") || name.endsWith("_wood")) {
                        JsonObject tj = new JsonObject();
                        tj.addProperty("x", bp.getX());
                        tj.addProperty("y", bp.getY());
                        tj.addProperty("z", bp.getZ());
                        tj.addProperty("block", name);
                        tj.addProperty("dist", (int) Math.sqrt(dx * dx + dy * dy + dz * dz));
                        distantTrees.add(tj);
                        fcount++;
                    }
                }
        root.add("distantTrees", distantTrees);
        root.addProperty("distantScanRadius", FR);

        JsonObject bar = new JsonObject();
        bar.addProperty("available", BaritoneBridge.AVAILABLE);
        if (BaritoneBridge.AVAILABLE) {
            try {
                bar.addProperty("active", BaritoneBridge.isActive());
                String goal = BaritoneBridge.goalString();
                if (goal != null) bar.addProperty("goal", goal);
                Double eta = BaritoneBridge.etaTicks();
                if (eta != null) bar.addProperty("etaTicks", eta);
            } catch (Throwable ignored) {
            }
        }
        root.add("baritone", bar);

        JsonArray chat = new JsonArray();
        for (String m : CHAT) chat.add(m);
        root.add("recentChat", chat);

        if (mineTarget != null) {
            JsonObject mt = new JsonObject();
            mt.addProperty("x", mineTarget.getX());
            mt.addProperty("y", mineTarget.getY());
            mt.addProperty("z", mineTarget.getZ());
            root.add("mineTarget", mt);   // present = still mining; gone = done/cleared
        }

        return GSON.toJson(root);
    }

    private static JsonObject itemJson(ItemStack st) {
        JsonObject o = new JsonObject();
        if (st.isEmpty()) {
            o.addProperty("empty", true);
            return o;
        }
        o.addProperty("item", BuiltInRegistries.ITEM.getKey(st.getItem()).toString());
        o.addProperty("count", st.getCount());
        o.addProperty("name", st.getHoverName().getString());
        return o;
    }

    private static JsonObject hitResultJson(Minecraft mc, LocalPlayer player) {
        JsonObject o = new JsonObject();
        HitResult hr = mc.hitResult;
        if (hr == null) {
            o.addProperty("type", "NONE");
            return o;
        }
        o.addProperty("type", hr.getType().name());
        if (hr.getType() == HitResult.Type.BLOCK) {
            BlockHitResult bhr = (BlockHitResult) hr;
            BlockPos p = bhr.getBlockPos();
            JsonObject bp = new JsonObject();
            bp.addProperty("x", p.getX());
            bp.addProperty("y", p.getY());
            bp.addProperty("z", p.getZ());
            o.add("pos", bp);
            o.addProperty("face", bhr.getDirection().getName());
            o.addProperty("block", BuiltInRegistries.BLOCK.getKey(player.level().getBlockState(p).getBlock()).toString());
        } else if (hr.getType() == HitResult.Type.ENTITY) {
            Entity e = ((EntityHitResult) hr).getEntity();
            o.addProperty("entityId", e.getId());
            o.addProperty("entityType", BuiltInRegistries.ENTITY_TYPE.getKey(e.getType()).toString());
        }
        return o;
    }

    // ----------------------------------------------------------------- helpers

    private static boolean baritoneActive() {
        if (!BaritoneBridge.AVAILABLE) return false;
        try {
            return BaritoneBridge.isActive();
        } catch (Throwable t) {
            return false;
        }
    }

    private static boolean requireBaritone() {
        if (!BaritoneBridge.AVAILABLE) {
            McAgentMod.LOGGER.warn("[mcagent] command needs Baritone, but it is not installed");
            return false;
        }
        return true;
    }

    private static boolean getBool(JsonObject o, String key, boolean def) {
        return o.has(key) ? o.get(key).getAsBoolean() : def;
    }

    private static float getFloat(JsonObject o, String key, float def) {
        return o.has(key) ? (float) o.get(key).getAsDouble() : def;
    }

    private ClientTickHandler() {}
}

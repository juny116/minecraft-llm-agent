package mcagent;

import baritone.api.BaritoneAPI;
import baritone.api.IBaritone;
import baritone.api.pathing.goals.Goal;
import baritone.api.pathing.goals.GoalBlock;
import baritone.api.pathing.goals.GoalNear;
import baritone.api.pathing.goals.GoalXZ;

import net.minecraft.core.BlockPos;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.player.Player;

import java.util.function.Predicate;

/**
 * Thin wrapper over the Baritone public API for navigation.
 *
 * Baritone is OPTIONAL. {@link #AVAILABLE} is resolved once at class load via a
 * name lookup that does not link any Baritone type, so this class loads fine even
 * when Baritone is not installed. Callers must check {@link #AVAILABLE} before
 * invoking any other method (those methods DO link Baritone types).
 *
 * Runtime requirement: the baritone-unoptimized-neoforge jar in the mods folder
 * (the obfuscated "standalone" build strips the baritone.api classes and will NOT
 * work for API access).
 */
public final class BaritoneBridge {
    public static final boolean AVAILABLE;
    static {
        boolean ok;
        try {
            Class.forName("baritone.api.BaritoneAPI");
            ok = true;
        } catch (Throwable t) {
            ok = false;
        }
        AVAILABLE = ok;
    }

    private static IBaritone b() {
        return BaritoneAPI.getProvider().getPrimaryBaritone();
    }

    public static void gotoBlock(int x, int y, int z) {
        b().getCustomGoalProcess().setGoalAndPath(new GoalBlock(x, y, z));
    }

    public static void gotoXZ(int x, int z) {
        b().getCustomGoalProcess().setGoalAndPath(new GoalXZ(x, z));
    }

    public static void gotoNear(int x, int y, int z, int range) {
        b().getCustomGoalProcess().setGoalAndPath(new GoalNear(new BlockPos(x, y, z), range));
    }

    public static void cancel() {
        b().getPathingBehavior().cancelEverything();
        b().getFollowProcess().cancel();
    }

    public static void followEntityId(int id) {
        b().getFollowProcess().follow((Predicate<Entity>) e -> e.getId() == id);
    }

    public static void followPlayers() {
        b().getFollowProcess().follow((Predicate<Entity>) e -> e instanceof Player);
    }

    /** True while Baritone is actively driving the player (pathing or following). */
    public static boolean isActive() {
        IBaritone bb = b();
        return bb.getPathingBehavior().isPathing() || !bb.getFollowProcess().following().isEmpty();
    }

    public static String goalString() {
        Goal g = b().getPathingBehavior().getGoal();
        return g == null ? null : g.toString();
    }

    public static Double etaTicks() {
        return b().getPathingBehavior().estimatedTicksToGoal().orElse(null);
    }

    private BaritoneBridge() {}
}

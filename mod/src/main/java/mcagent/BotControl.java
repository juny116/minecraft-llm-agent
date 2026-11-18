package mcagent;

import com.google.gson.JsonObject;

import java.util.concurrent.ConcurrentLinkedQueue;

/**
 * Shared state between the network thread (ControlServer) and the client thread
 * (ClientTickHandler).
 *
 * The network thread ONLY writes commands into {@link #inbox} and reads the
 * volatile {@link #snapshot} string. It never touches Minecraft objects.
 * All Minecraft access happens on the client thread inside ClientTickHandler.
 */
public final class BotControl {
    public static final BotControl INSTANCE = new BotControl();

    /** Commands queued from the network thread, drained each client tick. */
    public final ConcurrentLinkedQueue<JsonObject> inbox = new ConcurrentLinkedQueue<>();

    /** Latest world/player snapshot as a JSON string, refreshed every tick. */
    public volatile String snapshot = "{\"ready\":false}";

    private BotControl() {}

    public void submit(JsonObject cmd) {
        inbox.add(cmd);
    }
}

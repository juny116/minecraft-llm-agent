package mcagent;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;

/**
 * Tiny newline-delimited-JSON TCP control server.
 *
 * Protocol: one JSON object per line, in and out.
 *   -> {"type":"state"}            <- the latest snapshot JSON
 *   -> {"type":"ping"}             <- {"pong":true}
 *   -> anything else               queued for the client thread, <- {"ok":true,"type":...}
 *
 * Test it with:  python3 -c "..."  or  nc 127.0.0.1 25599
 */
public final class ControlServer {
    private static volatile boolean started = false;

    public static synchronized void start(String host, int port) {
        if (started) return;
        started = true;
        Thread t = new Thread(() -> runAcceptLoop(host, port), "mcagent-control");
        t.setDaemon(true);
        t.start();
        McAgentMod.LOGGER.info("[mcagent] control server starting on {}:{}", host, port);
    }

    private static void runAcceptLoop(String host, int port) {
        try {
            java.net.InetAddress bind = (host == null || host.isEmpty() || host.equals("loopback"))
                    ? java.net.InetAddress.getLoopbackAddress()
                    : java.net.InetAddress.getByName(host);
            runAcceptLoop(bind, port);
        } catch (Exception e) {
            McAgentMod.LOGGER.error("[mcagent] control server failed to bind {}:{}", host, port, e);
        }
    }

    private static void runAcceptLoop(java.net.InetAddress bindAddr, int port) {
        try (ServerSocket server = new ServerSocket(port, 4, bindAddr)) {
            while (true) {
                Socket client = server.accept();
                Thread h = new Thread(() -> handle(client), "mcagent-conn");
                h.setDaemon(true);
                h.start();
            }
        } catch (Exception e) {
            McAgentMod.LOGGER.error("[mcagent] control server stopped", e);
        }
    }

    private static void handle(Socket socket) {
        McAgentMod.LOGGER.info("[mcagent] client connected: {}", socket.getRemoteSocketAddress());
        try (Socket s = socket;
             BufferedReader in = new BufferedReader(new InputStreamReader(s.getInputStream(), StandardCharsets.UTF_8));
             BufferedWriter out = new BufferedWriter(new OutputStreamWriter(s.getOutputStream(), StandardCharsets.UTF_8))) {
            String line;
            while ((line = in.readLine()) != null) {
                line = line.trim();
                if (line.isEmpty()) continue;
                String reply;
                try {
                    JsonObject cmd = JsonParser.parseString(line).getAsJsonObject();
                    String type = cmd.has("type") ? cmd.get("type").getAsString() : "";
                    switch (type) {
                        case "state":
                            reply = BotControl.INSTANCE.snapshot;
                            break;
                        case "ping":
                            reply = "{\"pong\":true}";
                            break;
                        default:
                            BotControl.INSTANCE.submit(cmd);
                            reply = "{\"ok\":true,\"type\":\"" + type + "\"}";
                            break;
                    }
                } catch (Exception parseErr) {
                    reply = "{\"ok\":false,\"error\":\"bad json\"}";
                }
                out.write(reply);
                out.write('\n');
                out.flush();
            }
        } catch (Exception e) {
            McAgentMod.LOGGER.info("[mcagent] client disconnected: {}", e.getMessage());
        }
    }

    private ControlServer() {}
}

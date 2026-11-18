package mcagent;

import com.mojang.logging.LogUtils;

import net.neoforged.api.distmarker.Dist;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.fml.common.Mod;
import net.neoforged.fml.event.lifecycle.FMLClientSetupEvent;
import net.neoforged.neoforge.common.NeoForge;
import org.slf4j.Logger;

@Mod(value = McAgentMod.MODID, dist = Dist.CLIENT)
public class McAgentMod {
    public static final String MODID = "mcagent";
    public static final Logger LOGGER = LogUtils.getLogger();

    /** Control port. Override with -Dmcagent.port=NNNNN on the client JVM. */
    public static final int PORT = Integer.getInteger("mcagent.port", 25599);

    /** Bind address. Default loopback (127.0.0.1). Set -Dmcagent.host=0.0.0.0 to
     *  accept connections from WSL / LAN (e.g. controller running in WSL with NAT
     *  networking). */
    public static final String HOST = System.getProperty("mcagent.host", "loopback");

    public McAgentMod(IEventBus modEventBus) {
        modEventBus.addListener(this::onClientSetup);
        NeoForge.EVENT_BUS.addListener(ClientTickHandler::onClientTickPre);
        NeoForge.EVENT_BUS.addListener(ClientTickHandler::onClientTickPost);
        NeoForge.EVENT_BUS.addListener(ClientTickHandler::onClientChat);
        LOGGER.info("[mcagent] constructed");
    }

    private void onClientSetup(FMLClientSetupEvent event) {
        ControlServer.start(HOST, PORT);
        LOGGER.info("[mcagent] client setup complete, bind = {}:{}", HOST, PORT);
    }
}

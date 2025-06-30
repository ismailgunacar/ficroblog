import { Person, createFederation } from "@fedify/fedify";
import { InProcessMessageQueue, MemoryKvStore } from "@fedify/fedify";
import { getLogger } from "@logtape/logtape";
import { getUser } from "./models.js";

const logger = getLogger("fongoblog6");

const federation = createFederation({
  kv: new MemoryKvStore(),
  queue: new InProcessMessageQueue(),
});

federation.setActorDispatcher(
  "/users/{identifier}",
  async (ctx, identifier) => {
    try {
      logger.info("Looking up actor", { identifier });
      const user = await getUser(identifier);
      if (!user) {
        logger.warn("User not found", { identifier });
        return null;
      }

      const actor = new Person({
        id: ctx.getActorUri(identifier),
        preferredUsername: user.username,
        name: user.name || user.username,
      });

      logger.info("Actor created successfully", {
        identifier,
        username: user.username,
      });
      return actor;
    } catch (error) {
      logger.error("Error in actor dispatcher", { identifier, error });
      throw error;
    }
  },
);

export default federation;

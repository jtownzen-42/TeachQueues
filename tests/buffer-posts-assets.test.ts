// Locks the createPost image asset shape to what developers.buffer.com documents (checked 2026-11-02):
// CreatePostInput.assets: [AssetInput!]!, AssetInput = exactly one of image | video | document,
// ImageAssetInput { url: String! ... }, example assets: [{ image: { url } }]; no linkAttachment with assets.
import { describe, expect, it } from "vitest";
import { buildCreatePostInput } from "@/lib/buffer/posts";
import { draftSafe } from "@/lib/testmode";

const IMG = "https://fake.public.blob.vercel-storage.com/teachqueue/lessons/x.png";
const NETWORKS = ["x", "facebook", "linkedin"] as const;

describe("createPost image asset shape (Buffer docs)", () => {
  for (const network of NETWORKS) {
    it(`${network}: exact JSON with assets: [{ image: { url } }] and saveToDraft:true`, () => {
      for (const testMode of [true, false]) {
        const input = draftSafe(buildCreatePostInput({ channelId: "ch_test_1", network, text: "Hi", mode: "queue", testMode, imageUrl: IMG }), testMode);
        expect(input).toEqual({
          channelId: "ch_test_1", text: "Hi", schedulingType: "automatic", mode: "addToQueue", saveToDraft: true,
          ...(network === "facebook" ? { metadata: { facebook: { type: "post" } } } : {}),
          assets: [{ image: { url: IMG } }],
        });
      }
    });
  }

  it("each asset has exactly one variant (image) and the image has only url", () => {
    const input = buildCreatePostInput({ channelId: "ch_test_1", network: "linkedin", text: "Hi", mode: "queue", testMode: true, imageUrl: IMG });
    expect(input.assets).toHaveLength(1);
    expect(Object.keys(input.assets![0])).toEqual(["image"]);
    expect(Object.keys(input.assets![0].image)).toEqual(["url"]);
  });

  it("never sends linkAttachment alongside assets", () => {
    for (const network of NETWORKS) {
      const json = JSON.stringify(buildCreatePostInput({ channelId: "c", network, text: "Hi https://example.com", mode: "queue", testMode: true, imageUrl: IMG }));
      expect(json).not.toMatch(/linkAttachment/);
      expect(json).not.toMatch(/"link"/);
    }
  });

  it("no image (undefined, null or empty) -> no assets key at all", () => {
    for (const imageUrl of [undefined, null, ""]) {
      expect(buildCreatePostInput({ channelId: "c", network: "x", text: "Hi", mode: "queue", testMode: true, imageUrl })).not.toHaveProperty("assets");
    }
  });
});

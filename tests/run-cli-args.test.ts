import { afterEach, describe, expect, it, vi } from "vitest";
import { parseArgs } from "../bin/run.js";

describe("parseArgs reel stage5 overrides", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("parses Hyperframes renderer and template", () => {
    expect(parseArgs(["ns", "--reel", "--stage5-renderer", "hyperframes", "--stage5-template", "enhanced-default"])).toEqual(
      expect.objectContaining({
        brand: "ns",
        reel: true,
        stage5Renderer: "hyperframes",
        stage5Template: "enhanced-default",
      }),
    );
  });

  it("rejects missing stage5 renderer", () => {
    const exit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(() => parseArgs(["ns", "--reel", "--stage5-renderer"])).toThrow("process.exit");

    expect(error).toHaveBeenCalledWith("Missing value for --stage5-renderer. Valid: hyperframes");
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("rejects missing stage5 template", () => {
    const exit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(() => parseArgs(["ns", "--reel", "--stage5-template", "--dry-run"])).toThrow("process.exit");

    expect(error).toHaveBeenCalledWith("Missing value for --stage5-template. Valid: enhanced-default");
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("rejects retired ffmpeg stage5 renderer", () => {
    const exit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(() => parseArgs(["ns", "--reel", "--stage5-renderer", "ffmpeg"])).toThrow("process.exit");

    expect(error).toHaveBeenCalledWith("Invalid stage5 renderer: ffmpeg. ffmpeg is retired; use hyperframes. Valid: hyperframes");
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("rejects unknown stage5 renderer", () => {
    const exit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(() => parseArgs(["ns", "--reel", "--stage5-renderer", "canvas"])).toThrow("process.exit");

    expect(error).toHaveBeenCalledWith("Invalid stage5 renderer: canvas. Valid: hyperframes");
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("rejects stage5 renderer without --reel", () => {
    const exit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(() => parseArgs(["ns", "--stage5-renderer", "hyperframes"])).toThrow("process.exit");

    expect(error).toHaveBeenCalledWith("--stage5-renderer and --stage5-template require --reel");
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("rejects stage5 template without --reel", () => {
    const exit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(() => parseArgs(["ns", "--stage5-template", "enhanced-default"])).toThrow("process.exit");

    expect(error).toHaveBeenCalledWith("--stage5-renderer and --stage5-template require --reel");
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("rejects unknown stage5 template", () => {
    const exit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(() => parseArgs(["ns", "--reel", "--stage5-template", "basic"])).toThrow("process.exit");

    expect(error).toHaveBeenCalledWith("Unknown stage5 template: basic. Valid: enhanced-default");
    expect(exit).toHaveBeenCalledWith(1);
  });
});

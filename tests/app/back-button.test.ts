import { describe, expect, it, vi } from "vitest";
import { createBackButton, type BackEnv } from "@/lib/back-button";

/** A browser history and its open windows, faked: `press()` is the phone's back button. */
function fakeEnv() {
  const entries: { trap: boolean }[] = [{ trap: false }];
  let index = 0;
  const dialogs: (() => void)[] = [];
  let onPop: () => void = () => {};
  const env: BackEnv = {
    push: () => {
      entries.splice(index + 1, Infinity, { trap: true });
      index += 1;
    },
    back: () => {
      // Like the browser: the traversal lands later, then popstate fires.
      queueMicrotask(() => {
        index -= 1;
        onPop();
      });
    },
    isTrap: () => entries[index]?.trap === true,
    closeTopDialog: () => {
      const close = dialogs.pop();
      close?.();
      return close !== undefined;
    },
    hasOpenDialog: () => dialogs.length > 0,
  };
  return {
    env,
    entries: () => entries.slice(0, index + 1).map((e) => (e.trap ? "trap" : "page")),
    listen: (fn: () => void) => (onPop = fn),
    openDialog: (onClose: () => void) => dialogs.push(onClose),
    /** A link to another page of the app: the router pushes a plain entry, no popstate. */
    navigate: () => {
      entries.splice(index + 1, Infinity, { trap: false });
      index += 1;
    },
    /** The user presses back: the browser leaves the app when there's no entry of ours to pop. */
    press: () => {
      if (index === 0) return "left the app";
      index -= 1;
      onPop();
      return "stayed";
    },
  };
}

const settle = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

function setup() {
  const f = fakeEnv();
  const back = createBackButton(f.env);
  f.listen(back.onPopState);
  return { ...f, back };
}

describe("createBackButton", () => {
  it("leaves the history alone while nothing has a Back (the start menu)", async () => {
    const { back, entries, press } = setup();
    back.sync();
    await settle();
    expect(entries()).toEqual(["page"]);
    expect(press()).toBe("left the app");
  });

  it("a screen with a Back keeps one trap entry, and back runs that screen's Back", async () => {
    const { back, entries, press } = setup();
    const onBack = vi.fn();
    back.register(onBack);
    await settle();
    expect(entries()).toEqual(["page", "trap"]);
    expect(press()).toBe("stayed");
    expect(onBack).toHaveBeenCalledTimes(1);
    await settle();
    // Still on that screen (say, the leave confirm opened): the trap is back for the next press.
    expect(entries()).toEqual(["page", "trap"]);
  });

  it("removes the trap once no screen needs it, so the next back leaves normally", async () => {
    const { back, entries, press } = setup();
    const screen = back.register(() => {});
    await settle();
    screen.remove();
    await settle();
    expect(entries()).toEqual(["page"]);
    expect(press()).toBe("left the app");
  });

  it("back closes the topmost open window before the screen's Back", async () => {
    const { back, entries, press, openDialog } = setup();
    const onBack = vi.fn();
    const closeFirst = vi.fn();
    const closeTop = vi.fn();
    back.register(onBack);
    openDialog(closeFirst);
    openDialog(closeTop);
    back.sync();
    await settle();
    press();
    expect(closeTop).toHaveBeenCalledTimes(1);
    expect(closeFirst).not.toHaveBeenCalled();
    expect(onBack).not.toHaveBeenCalled();
    await settle();
    expect(entries()).toEqual(["page", "trap"]);
  });

  it("an open window alone (no screen Back) also keeps the trap, then lets go once it closes", async () => {
    const { back, entries, press, openDialog } = setup();
    const close = vi.fn();
    openDialog(close);
    back.sync();
    await settle();
    expect(entries()).toEqual(["page", "trap"]);
    press();
    expect(close).toHaveBeenCalled();
    await settle();
    expect(entries()).toEqual(["page"]);
  });

  it("a screen swap in one render (picker → chat) doesn't touch the history", async () => {
    const { back, entries, env } = setup();
    const push = vi.spyOn(env, "push");
    const goBack = vi.spyOn(env, "back");
    const picker = back.register(() => {});
    await settle();
    picker.remove();
    back.register(() => {});
    await settle();
    expect(entries()).toEqual(["page", "trap"]);
    expect(push).toHaveBeenCalledTimes(1);
    expect(goBack).not.toHaveBeenCalled();
  });

  it("the latest screen's Back runs, with its newest handler", async () => {
    const { back, press } = setup();
    const first = vi.fn();
    const second = vi.fn();
    const newer = vi.fn();
    back.register(first);
    const top = back.register(second);
    top.update(newer);
    await settle();
    press();
    expect(newer).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
    expect(first).not.toHaveBeenCalled();
  });

  it("after a reload on a trap entry, it reuses it instead of adding another", async () => {
    const f = fakeEnv();
    f.env.push(); // left by the page before the reload
    const back = createBackButton(f.env);
    f.listen(back.onPopState);
    back.register(() => {});
    await settle();
    expect(f.entries()).toEqual(["page", "trap"]);
  });

  it("a link from a screen with a Back to a page without one stays on that page (picker → Add persona)", async () => {
    const { back, entries, env, navigate } = setup();
    const goBack = vi.spyOn(env, "back");
    const picker = back.register(() => {});
    await settle();
    navigate(); // the add button: a new entry on top of the trap
    picker.remove(); // the picker unmounts with the old page
    await settle();
    expect(goBack).not.toHaveBeenCalled();
    expect(entries()).toEqual(["page", "trap", "page"]);
  });

  it("a link to a page whose screen has a Back puts a trap on that page", async () => {
    const { back, entries, navigate } = setup();
    const picker = back.register(() => {});
    await settle();
    navigate();
    picker.remove();
    back.register(() => {}); // the new page's screen, in the same render
    await settle();
    expect(entries()).toEqual(["page", "trap", "page", "trap"]);
  });

  it("a back that lands outside a trap (another page of the app) runs nothing", async () => {
    const { back, press } = setup();
    const onBack = vi.fn();
    back.register(onBack);
    await settle();
    press(); // pops the trap: runs onBack
    await settle();
    expect(onBack).toHaveBeenCalledTimes(1);
    back.onPopState(); // a stray popstate, no trap consumed
    await settle();
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

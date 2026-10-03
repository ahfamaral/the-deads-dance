import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ConfirmDialog from "@/components/confirm-dialog";

const noop = () => {};
const dialog = (title: string) => createElement(ConfirmDialog, { open: false, title, message: `${title} body`, onConfirm: noop, onCancel: noop });

describe("ConfirmDialog", () => {
  // Final review, Important 1: two dialogs on one page must each label themselves, not the first one.
  it("gives each mounted dialog its own heading and message ids", () => {
    const html = renderToStaticMarkup(createElement(Fragment, null, dialog("Save conversation"), dialog("Leave?")));
    const labelled = [...html.matchAll(/aria-labelledby="([^"]+)"/g)].map((m) => m[1]);
    const described = [...html.matchAll(/aria-describedby="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(labelled).size).toBe(2);
    expect(new Set(described).size).toBe(2);
    for (const id of [...labelled, ...described]) expect(html).toContain(`id="${id}"`);
  });
});

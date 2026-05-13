import test from "node:test";
import assert from "node:assert/strict";

import {
  classifyRecordEditButtonCandidate,
  contactTargetKindFromSubmission,
  mentionResultsForUnavailableEditor,
  typeMentionSegments
} from "../src/lib/shelfcycle-automation.mjs";

class FakeLocator {
  constructor({ count = 0, onClick = () => {}, isVisible = true } = {}) {
    this.countValue = count;
    this.onClick = onClick;
    this.visible = isVisible;
  }

  first() {
    return this;
  }

  filter() {
    return this;
  }

  getByText() {
    return this;
  }

  async count() {
    return this.countValue;
  }

  async isVisible() {
    return this.visible && this.countValue > 0;
  }

  async click() {
    this.onClick();
  }
}

function fakePageWithMentionOptions(resolveLabels = [], { stickyLabels = [] } = {}) {
  const labels = new Set(resolveLabels);
  const sticky = new Set(stickyLabels);
  const selected = [];
  const typed = [];
  const pressed = [];

  const optionFor = (matcher) => {
    const label = [...labels].find((item) => matcher?.test?.(item));

    return new FakeLocator({
      count: label ? 1 : 0,
      onClick: () => {
        selected.push(label);
        if (!sticky.has(label)) {
          labels.delete(label);
        }
      }
    });
  };

  return {
    selected,
    typed,
    pressed,
    keyboard: {
      insertText: async (text) => typed.push(text),
      type: async (text) => typed.push(text),
      press: async (key) => pressed.push(key)
    },
    waitForTimeout: async () => {},
    getByRole: (_role, options = {}) => optionFor(options.name),
    getByText: (matcher) => optionFor(matcher),
    locator: () => new FakeLocator()
  };
}

test("typeMentionSegments links all mention picker matches", async () => {
  const page = fakePageWithMentionOptions(["Erin Christos", "Rucolac B-591"]);
  const results = await typeMentionSegments(page, [
    { type: "text", text: "Talked to " },
    { type: "mention", mention: { kind: "contact", label: "Erin Christos" } },
    { type: "text", text: " about " },
    { type: "mention", mention: { kind: "product", label: "Rucolac B-591" } },
    { type: "text", text: "." }
  ]);

  assert.deepEqual(results.map((result) => result.status), ["linked", "linked"]);
  assert.deepEqual(page.selected, ["Erin Christos", "Rucolac B-591"]);
  assert.equal(page.typed.join(""), "Talked to @Erin Christos about @Rucolac B-591.");
});

test("typeMentionSegments clicks prefixed ShelfCycle picker rows", async () => {
  const page = fakePageWithMentionOptions(["Customer: Surface Koatings, Inc"]);
  const results = await typeMentionSegments(page, [
    { type: "mention", mention: { kind: "customer", label: "Surface Koatings, Inc" } }
  ]);

  assert.equal(results[0].status, "linked");
  assert.deepEqual(page.selected, ["Customer: Surface Koatings, Inc"]);
});

test("typeMentionSegments uses natural occurrence text as the mention search trigger", async () => {
  const page = fakePageWithMentionOptions(["Customer: Surface Koatings, Inc"]);
  const results = await typeMentionSegments(page, [
    { type: "mention", text: "Surface Koatings", mention: { kind: "customer", label: "Surface Koatings, Inc" } }
  ]);

  assert.equal(results[0].status, "linked");
  assert.equal(page.typed.join(""), "@Surface Koatings");
  assert.deepEqual(page.selected, ["Customer: Surface Koatings, Inc"]);
});

test("typeMentionSegments presses Enter for rich-text newlines before appended mentions", async () => {
  const page = fakePageWithMentionOptions(["Contact: Blake Grindstaff"]);
  const results = await typeMentionSegments(page, [
    { type: "text", text: "\n\nRelated records:\n" },
    { type: "mention", mention: { kind: "contact", label: "Blake Grindstaff" } }
  ]);

  assert.equal(results[0].status, "linked");
  assert.deepEqual(page.typed, ["Related records:", "@Blake Grindstaff"]);
  assert.equal(page.pressed.filter((key) => key === "Enter").length, 3);
});

test("typeMentionSegments supports ShelfCycle product family picker rows", async () => {
  const page = fakePageWithMentionOptions(["Product Family: Rucolac B-591"]);
  const results = await typeMentionSegments(page, [
    { type: "mention", text: "Rucolac B-591", mention: { kind: "product", label: "RucoB591-D" } }
  ]);

  assert.equal(results[0].status, "linked");
  assert.deepEqual(page.selected, ["Product Family: Rucolac B-591"]);
});

test("typeMentionSegments adds a boundary after unresolved mention attempts", async () => {
  const page = fakePageWithMentionOptions([]);
  const results = await typeMentionSegments(page, [
    { type: "mention", mention: { kind: "contact", label: "Blake Grindstaff" } },
    { type: "text", text: "\n" },
    { type: "mention", mention: { kind: "product", label: "RucoB591-T" } }
  ]);

  assert.deepEqual(results.map((result) => result.status), ["plain_text", "plain_text"]);
  assert.deepEqual(page.typed, ["@Blake Grindstaff", " ", "@RucoB591-T", " "]);
  assert.equal(page.pressed.filter((key) => key === "Escape").length, 2);
  assert.equal(page.pressed.filter((key) => key === "Enter").length, 1);
});

test("typeMentionSegments retries selection before reporting unresolved picker rows", async () => {
  const page = fakePageWithMentionOptions(["Customer: Surface Koatings, Inc"], {
    stickyLabels: ["Customer: Surface Koatings, Inc"]
  });
  const results = await typeMentionSegments(page, [
    { type: "mention", mention: { kind: "customer", label: "Surface Koatings, Inc" } }
  ]);

  assert.equal(results[0].status, "plain_text");
  assert.equal(results[0].warning, "Mention option did not commit.");
  assert.deepEqual(page.selected, ["Customer: Surface Koatings, Inc", "Customer: Surface Koatings, Inc"]);
  assert.ok(page.pressed.includes("Enter"));
});

test("typeMentionSegments keeps unresolved mentions as plain text and warns", async () => {
  const page = fakePageWithMentionOptions(["Erin Christos"]);
  const results = await typeMentionSegments(page, [
    { type: "mention", mention: { kind: "contact", label: "Erin Christos" } },
    { type: "text", text: " / " },
    { type: "mention", mention: { kind: "product", label: "Rucolac B-591" } }
  ]);

  assert.deepEqual(results.map((result) => result.status), ["linked", "plain_text"]);
  assert.equal(results[1].warning, "Mention option not found.");
  assert.ok(page.pressed.includes("Escape"));
});

test("mentionResultsForUnavailableEditor marks every requested mention as plain text", () => {
  const results = mentionResultsForUnavailableEditor([
    { kind: "customer", label: "Surface Koatings, Inc" },
    { kind: "contact", label: "Erin Christos" }
  ]);

  assert.deepEqual(results.map((result) => result.status), ["plain_text", "plain_text"]);
  assert.ok(results.every((result) => result.warning === "Rich-text mentions unavailable on this form."));
});

test("contactTargetKindFromSubmission resolves customer and supplier contact targets", () => {
  assert.equal(contactTargetKindFromSubmission({
    customerName: "Surface Koatings, Inc",
    fields: { companyType: "customer" }
  }), "customer");

  assert.equal(contactTargetKindFromSubmission({
    supplierName: "MAK Chemicals",
    fields: { companyType: "supplier" }
  }), "supplier");

  assert.equal(contactTargetKindFromSubmission({
    fields: { companyType: "Supplier" }
  }), "supplier");
});

test("classifyRecordEditButtonCandidate prefers upper-right edit icon buttons", () => {
  const candidate = classifyRecordEditButtonCandidate({
    text: "",
    ariaLabel: "",
    title: "",
    className: "mantine-ActionIcon-root",
    html: '<button><svg class="tabler-icon tabler-icon-edit"></svg></button>',
    hasSvg: true,
    top: 48,
    right: 1320,
    width: 42,
    height: 42,
    viewportWidth: 1440,
    visible: true
  });

  assert.equal(candidate.hasEditSignal, true);
  assert.equal(candidate.isUpperRight, true);
  assert.ok(candidate.score >= 130);
});

test("classifyRecordEditButtonCandidate rejects unsafe upper-right action buttons", () => {
  const candidate = classifyRecordEditButtonCandidate({
    text: "Delete",
    ariaLabel: "Delete supplier",
    html: '<button><svg></svg></button>',
    hasSvg: true,
    top: 48,
    right: 1320,
    width: 42,
    height: 42,
    viewportWidth: 1440,
    visible: true
  });

  assert.equal(candidate.unsafe, true);
  assert.equal(candidate.score, -1);
});

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

function fixture(dual = false) {
  let extension, clock = 0;
  const frames = new Map();
  let frameId = 0;
  const graphCanvas = { isConnected: true };
  const app = {
    canvas: { canvas: graphCanvas, setDirty() {} },
    registerExtension(value) { extension = value; },
  };
  const scope = {
    app, console, performance: { now: () => clock += 16 },
    LiteGraph: { vueNodesMode: true, NODE_SUBTEXT_SIZE: 12, NODE_FONT: "Inter" },
    requestAnimationFrame(callback) { frames.set(++frameId, callback); return frameId; },
    cancelAnimationFrame(id) { frames.delete(id); },
    window: { clearTimeout() {}, setTimeout() { return 1; } },
    fetch: () => new Promise(() => {}),
  };
  scope.globalThis = scope;
  const source = fs.readFileSync(path.join(__dirname, "../web/lora_chain_loader_with_metadata.js"), "utf8")
    .replace(/^import .*;\r?\n/gm, "");
  vm.runInNewContext(source, scope);
  function Node() {
    this.widgets = [{ name: "lora_stack", value: JSON.stringify({
      rows: ["A", "B", "C"].map(id => ({ id, lora_1: "None", enabled: true })),
    }) }];
    this.inputs = [];
    this.size = [dual ? 640 : 440, 120];
    this.graph = { setDirtyCanvas() {} };
  }
  Node.prototype.addWidget = function (type, name, value, callback) {
    const widget = { type, name, value, callback }; this.widgets.push(widget); return widget;
  };
  Node.prototype.addCustomWidget = function (widget) { this.widgets.push(widget); };
  Node.prototype.removeWidget = function (widget) {
    this.widgets.splice(this.widgets.indexOf(widget), 1); widget.onRemove?.();
  };
  Node.prototype.setSize = function (size) { this.size = size; };
  extension.beforeRegisterNodeDef(Node, {
    name: dual ? "HogKitLoraDualChainLoaderWithMetadata" : "HogKitLoraSingleChainLoaderWithMetadata",
  });
  const node = new Node();
  node.onNodeCreated();
  const chain = node.widgets.find(w => w.name === "lora_chain");

  function view(logicalWidth, zoom, classic = false) {
    const canvas = classic ? graphCanvas : {
      isConnected: true, parentElement: { clientWidth: logicalWidth }, style: {},
      listeners: new Map(),
      addEventListener(name, fn) { this.listeners.set(name, fn); },
      removeEventListener(name) { this.listeners.delete(name); },
      getBoundingClientRect() {
        return { left: 10, top: 20, width: this.parentElement.clientWidth * zoom,
          height: parseFloat(this.style.height) * zoom };
      },
    };
    let sx = 2, sy = 2;
    const stack = [];
    const ctx = new Proxy({
      canvas,
      save() { stack.push([sx, sy]); },
      restore() { [sx, sy] = stack.pop(); },
      scale(x, y) { sx *= x; sy *= y; },
      getTransform() { return { a: sx, d: sy }; },
      measureText(value) { return { width: String(value).length * 6 }; },
    }, { get(target, name) { return name in target ? target[name] : () => {}; } });
    let draws = 0;
    function draw() {
      draws++;
      canvas.width = logicalWidth * zoom * 2;
      canvas.height = (chain.computedHeight + 2) * 2;
      chain.draw(ctx, node, classic ? logicalWidth : logicalWidth * zoom, classic ? 150 : 1);
    }
    if (classic) draw(); else chain.triggerDraw = draw;
    const event = (type, x, y) => ({ type, currentTarget: canvas, target: canvas,
      clientX: 10 + x * zoom, clientY: 20 + y * zoom });
    return { canvas, ctx, draw, event, zoom, get draws() { return draws; } };
  }
  return { node, chain, view, frames, scope };
}

test("one stable stack widget owns all rows and fixed layout height", () => {
  const { node, chain } = fixture();
  assert.equal(node.widgets.filter(w => w.loraDynamicWidget).length, 1);
  assert.equal(chain.height, 3 * 44 + 68);
  assert.equal(chain.computeLayoutSize().minHeight, chain.height);
  const firstController = chain.rows[0];
  node.rows.push({ enabled: true, lora_1: "None" });
  node.rebuildWidgets();
  assert.equal(node.widgets.find(w => w.name === "lora_chain"), chain);
  assert.equal(chain.rows[0], firstController);
  assert.equal(chain.computedHeight, 4 * 44 + 68);
});

test("zoomed and sidebar hosts keep logical dimensions and nonoverlapping cards", () => {
  for (const dual of [false, true]) {
    for (const zoom of [0.25, 0.5, 1, 2]) {
      const { chain, view } = fixture(dual);
      for (const width of [dual ? 640 : 440, 900]) {
        const host = view(width, zoom);
        const geometry = chain.pointerCanvases.get(host.canvas);
        assert.equal(geometry.width, width);
        assert.equal(geometry.height, chain.height + 2);
        assert.equal(host.canvas.getBoundingClientRect().height, (chain.height + 2) * zoom);
        const rows = chain.rows.map(w => w.hitAreasByCanvas.get(host.canvas));
        for (let i = 1; i < rows.length; i++) {
          assert.ok(rows[i - 1].slot1.y + rows[i - 1].slot1.h < rows[i].slot1.y);
        }
        assert.equal(host.canvas.listeners.size, 2);
      }
    }
  }
});

test("drag tracks the pointer, animates neighbors, and commits only on release", () => {
  const { node, chain, view, frames } = fixture();
  const host = view(800, 0.5);
  const sidebar = view(440, 1);
  const controllers = [...chain.rows];
  const areas = chain.rows[0].hitAreasByCanvas.get(host.canvas);
  const pointer = { eDown: host.event("pointerdown", areas.drag.x + 8, areas.drag.y + 10) };
  assert.equal(chain.onPointerDown(pointer, node), true);
  pointer.onDrag(host.event("pointermove", areas.drag.x + 8, 1 + 2 * 44 + 22));
  assert.equal(node.dragLastTarget, 2);
  assert.deepEqual(Array.from(node.rows, r => r.id), ["A", "B", "C"]);
  assert.ok(chain.layouts.get(host.canvas).offsets[1] < 0);
  assert.equal(chain.layouts.get(host.canvas).offsets[0], chain.layouts.get(sidebar.canvas).offsets[0]);
  assert.ok(frames.size > 0);
  pointer.eUp = host.event("pointerup", areas.drag.x + 8, 1 + 2 * 44 + 22);
  pointer.finally();
  assert.deepEqual(Array.from(node.rows, r => r.id), ["B", "C", "A"]);
  assert.equal(chain.rows[2], controllers[0]);
  assert.equal(node.widgets.find(w => w.name === "lora_chain"), chain);
  assert.deepEqual(JSON.parse(node.stackWidget.value).rows.map(r => r.id), ["B", "C", "A"]);
  assert.equal(node.draggingRow, null);
});

test("pointer cancellation preserves order and toggles target the correct zoomed row", () => {
  const { node, chain, view } = fixture();
  const host = view(700, 0.25);
  const areas = chain.rows[1].hitAreasByCanvas.get(host.canvas);
  const click = { eDown: host.event("pointerdown", areas.toggle.x + 5, areas.toggle.y + 5) };
  chain.onPointerDown(click, node);
  assert.equal(node.rows[0].enabled, true);
  assert.equal(node.rows[1].enabled, false);
  assert.equal(node.rows[2].enabled, true);
  click.finally();
  const drag = { eDown: host.event("pointerdown", areas.drag.x + 5, areas.drag.y + 5) };
  chain.onPointerDown(drag, node);
  drag.onDrag(host.event("pointermove", areas.drag.x + 5, 1 + 2 * 44 + 22));
  drag.finally(); // No release event: loss of capture / cancellation.
  assert.deepEqual(Array.from(node.rows, r => r.id), ["A", "B", "C"]);
  assert.equal(node.draggingRow, null);
});

test("main canvas and sidebar use their own origins and independent hitboxes", () => {
  const { node, chain, view } = fixture();
  const graph = view(900, 1, true);
  view(440, 0.5);
  const areas = chain.rows[2].hitAreasByCanvas.get(graph.canvas);
  chain.mouse({ type: "pointerdown", target: graph.canvas }, [areas.drag.x + 5, areas.drag.y + 5], node);
  chain.mouse({ type: "pointermove", target: graph.canvas }, [areas.drag.x + 5, 150 + 22], node);
  chain.mouse({ type: "pointerup", target: graph.canvas }, [areas.drag.x + 5, 150 + 22], node);
  assert.deepEqual(Array.from(node.rows, r => r.id), ["C", "A", "B"]);
});

test("disconnected hosts and node removal stop callbacks and animations", () => {
  const { node, chain, view, frames } = fixture();
  const main = view(800, 0.5);
  const side = view(440, 1);
  main.canvas.isConnected = false;
  const draws = main.draws;
  chain.triggerDraw();
  assert.equal(main.draws, draws);
  assert.ok(side.draws > 1);
  node.onRemoved();
  assert.equal(chain.layouts.size, 0);
  assert.equal(frames.size, 0);
  assert.equal(side.canvas.listeners.size, 0);
});

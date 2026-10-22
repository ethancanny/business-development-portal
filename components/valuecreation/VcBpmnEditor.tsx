"use client";

/**
 * BPMN editor / viewer (Phase 6) — adapted from the diligence
 * BpmnEditor (Phase 5): bpmn-js Modeler for editing, NavigatedViewer
 * for read-only. Persistence is EXPLICIT SAVE ONLY: nothing is
 * written on change; the parent's Save button calls the exposed
 * handle, which serializes via saveXML. Loaded only via
 * next/dynamic (ssr: false) from ProcessMapsTab.
 */

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import Modeler from "bpmn-js/lib/Modeler";
import NavigatedViewer from "bpmn-js/lib/NavigatedViewer";
import "bpmn-js/dist/assets/diagram-js.css";
import "bpmn-js/dist/assets/bpmn-js.css";
import "bpmn-js/dist/assets/bpmn-font/css/bpmn.css";

type BpmnInstance = Modeler | NavigatedViewer;

interface EventBusLike {
  on: (event: string, callback: () => void) => void;
}

export interface VcBpmnEditorHandle {
  /** Serialize the modeler; null in read-only mode. */
  getXml: () => Promise<string | null>;
}

interface Props {
  xml: string;
  readOnly: boolean;
  /** Fires when the modeler reports a change (edit mode only). */
  onDirty: () => void;
  onError?: (message: string) => void;
}

const VcBpmnEditor = forwardRef<VcBpmnEditorHandle, Props>(function VcBpmnEditor(
  { xml, readOnly, onDirty, onError },
  ref
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const instanceRef = useRef<BpmnInstance | null>(null);
  const dirtyRef = useRef(onDirty);
  dirtyRef.current = onDirty;
  const errorRef = useRef(onError);
  errorRef.current = onError;

  useImperativeHandle(ref, () => ({
    getXml: async () => {
      const inst = instanceRef.current;
      if (!inst || readOnly) return null;
      const result = await (inst as Modeler).saveXML({ format: true });
      return result.xml ?? null;
    },
  }));

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !xml) return;

    const instance: BpmnInstance = readOnly
      ? new NavigatedViewer({ container })
      : new Modeler({ container });
    instanceRef.current = instance;

    let cancelled = false;
    void instance
      .importXML(xml)
      .then(() => {
        try {
          const canvas = instance.get("canvas") as unknown as {
            zoom: (mode: string) => void;
          };
          canvas.zoom("fit-viewport");
        } catch {
          /* zoom is cosmetic; ignore */
        }
      })
      .catch(() => {
        if (!cancelled)
          errorRef.current?.("Could not render that diagram XML.");
      });

    if (!readOnly) {
      try {
        const bus = instance.get("eventBus") as unknown as EventBusLike;
        bus.on("commandStack.changed", () => dirtyRef.current());
      } catch {
        /* dirty tracking is best-effort */
      }
    }

    return () => {
      cancelled = true;
      instanceRef.current = null;
      try {
        instance.destroy();
      } catch {
        /* already destroyed */
      }
    };
    // Rebuild whenever the diagram XML source or the mode changes.
  }, [xml, readOnly]);

  return (
    <div
      ref={containerRef}
      className="h-[520px] w-full overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-white/10"
      aria-label={readOnly ? "Process diagram (read-only)" : "Process diagram editor"}
    />
  );
});

export default VcBpmnEditor;

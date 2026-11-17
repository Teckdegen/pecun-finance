"use client";

/**
 * One-click execution entry point. Importing this loads every protocol module, each of which registers its own
 * adapter factory with the executor, then re-exports the executor API. UI code imports from here, not ../execute.
 */

// Protocol modules (each registers itself on import):

export * from "../execute";

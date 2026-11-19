"use client";

/**
 * One-click execution entry point. Importing this loads every protocol module, each of which registers its own
 * adapter factory with the executor, then re-exports the executor API. UI code imports from here, not ../execute.
 */

// Protocol modules (each registers itself on import):
import "./pendle";
import "./spectra";
import "./sui-lending";
import "./ember";
import "./upshift";
import "./avantis";
import "./kamino";
import "./meteora";
import "./jupiter-sol";
import "./gmx";
import "./beefy";
import "./frgmnt";

export * from "../execute";

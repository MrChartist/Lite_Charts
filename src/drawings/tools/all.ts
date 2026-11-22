// Every built-in tool (ALL_TOOLS), ordered by toolbar group. Import BASIC_TOOLS instead to ship only the first fifteen.

import type { ToolDefinition } from '../contract';
import { arrow, brush, channel, extended, fib, horizontalLine, horizontalRay, long, measure, ray, rectangle, short, text, trend, vertical } from './basic';
import { crossLine, horizontalSegment, infoLine, trendAngle } from './lines';
import { disjointChannel, flatChannel, insidePitchfork, modifiedSchiffPitchfork, pitchfork, regression, schiffPitchfork } from './channels';
import { fibArcs, fibChannel, fibExtension, fibFan, fibSpeedFan, fibTimeZones, gannBox, gannFan } from './fibonacci';
import { arc, curve, ellipse, polyline, rotatedRectangle, triangle } from './shapes';
import { anchoredVwapTool, datePriceRange, dateRange, priceRange, volumeProfileTool } from './ranges';
import { anchoredText, arrowDown, arrowUp, callout, flag, highlighter, priceLabel, priceNote } from './annotations';

export const ALL_TOOLS: readonly ToolDefinition[] = [
  trend, ray, extended, infoLine, trendAngle, horizontalLine, horizontalRay, horizontalSegment, vertical, crossLine,
  channel, regression, flatChannel, disjointChannel, pitchfork, schiffPitchfork, modifiedSchiffPitchfork, insidePitchfork,
  fib, fibExtension, fibChannel, fibFan, fibSpeedFan, fibArcs, fibTimeZones, gannFan, gannBox,
  rectangle, rotatedRectangle, ellipse, triangle, polyline, arc, curve,
  measure, priceRange, dateRange, datePriceRange, anchoredVwapTool, volumeProfileTool,
  long, short,
  text, anchoredText, callout, priceLabel, priceNote, arrowUp, arrowDown, flag, arrow, brush, highlighter,
];

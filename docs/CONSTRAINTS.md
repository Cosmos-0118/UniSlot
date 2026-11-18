# Scheduling rules

## Time model

One evening session, 5:00–7:00 PM, on each weekday. Monday–Friday by default. Saturday is available only to mathematics courses (when enabled) or to an explicit allow-list of course codes. Parallel "lanes" on a weekday are a display label for courses that run at the same time, not distinct times; about 11 sections per weekday is a comfort target, never a limit.

## Objective (strict lexicographic order)

1. **Minimise RED students**: students with two different courses on the same weekday. Each affected student counts once, however many overlaps they have.
2. **Minimise clash weight**: conflicting course pairs weighted by shared students, among timetables tied on RED.
3. **Balance weekday load** among timetables tied on 1 and 2.
4. **Reduce parallel excess** above the comfort target among the rest.

A lower level is never allowed to worsen a higher one. Zero RED is not always possible (a group of mutually conflicting courses larger than the number of weekdays, or a student with more courses than weekdays); UniSlot reports the structural minimum and never treats residual clashes as infeasibility.

## Hard rules (never traded away)

- Every course is placed on exactly one weekday, in the allowed range.
- All sections of a course share one weekday.
- An instructor teaches at most one section per weekday.
- Section size respects capacity.
- Saturday follows the policy above.

## Sections

A course with up to 64 students is one section (capacity 64). Larger courses split into `ceil(n / 60)` sections of capacity 60, balanced by load, with program cohesion as the tie-break. A named instructor stays on the first section; additional sections carry a `Planning:<section id>` placeholder until staff are assigned. Because every student belongs to exactly one section of each course, section membership cannot change the course-level objective.

## Optimality claims

`proven optimal` is reported only when the exact stage proves it. Otherwise the result is the best found, together with the proven lower bound when available and the structural minimum.

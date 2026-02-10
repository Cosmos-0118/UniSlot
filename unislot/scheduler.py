"""
Core scheduling algorithms: CP-SAT solver with advanced optimization.

This module provides bulletproof scheduling with:
- CP-SAT constraint programming for optimal solutions
- Advanced greedy algorithm with multi-factor prioritization
- Local search refinement for near-optimal results
- Multiple optimization strategies for minimum clashes
"""

import random
import time
from collections import defaultdict
from dataclasses import dataclass
from typing import Any, Optional

from ortools.sat.python import cp_model  # type: ignore[import-untyped]

from unislot.models import (
    ClashReport,
    ClashStatus,
    ConflictGraph,
    ConflictEdge,
    Day,
    INDEX_TO_DAY,
    Schedule,
    ScheduleEntry,
    Section,
    Student,
    StudentClashReport,
)
from unislot.preprocessing import get_all_sections

NUM_SLOTS = 5  # Monday to Friday (default)
NUM_SLOTS_WITH_SATURDAY = 6  # Monday to Saturday (for math courses)
DEFAULT_TIME_LIMIT_SECONDS = 180  # Increased for better solutions

# Optimization parameters
CLASH_WEIGHT = 1000  # Very high weight for clashes
BALANCE_WEIGHT = 10  # Weight for balance (increased for better distribution)
LOAD_BALANCE_FACTOR = 5  # Factor for greedy algorithm load balancing
QUADRATIC_PENALTY = True  # Use quadratic scaling for large conflicts
LOCAL_SEARCH_ITERATIONS = 500  # Iterations for local improvement
MULTI_START_RUNS = 10  # Number of greedy starts with randomization (increased for consistency)


def _is_math_course(course_code: str) -> bool:
    """
    Check if a course is a math course.
    
    Math courses (e.g., 21MAB201T) can be scheduled on Saturday
    because they have high enrollment and many clashes.
    """
    return "MAB" in course_code.upper()


def _calculate_parallel_cap(num_sections: int) -> int:
    """
    Auto-calculate optimal parallel cap based on total sections.
    
    Strategy: Distribute evenly across slots with ~20% buffer for flexibility.
    For 50 sections with 5 slots: 50/5 = 10, with buffer = 12
    """
    base_cap = (num_sections + NUM_SLOTS - 1) // NUM_SLOTS  # Ceiling division
    buffer = max(2, base_cap // 5)  # 20% buffer, minimum 2
    return base_cap + buffer


def _compute_clash_weight(conflict_graph: ConflictGraph,
                          assignments: dict[str, int]) -> int:
    """Compute total clash weight for a set of slot assignments."""
    total_clash = 0
    for edge in conflict_graph.edges:
        if assignments.get(edge.section_a) == assignments.get(edge.section_b):
            total_clash += edge.weight
    return total_clash


# Program name abbreviations for cleaner output
# Note: Keys should be descriptive enough to avoid false matches
PROGRAM_ABBREVIATIONS: dict[str, str] = {
    # CS variants
    "computer science and engineering": "CSE",
    "computer science": "CS",
    # AI/ML variants
    "artificial intelligence and machine learning": "AIML",
    "artificial intelligence": "AI",
    "machine learning": "ML",
    # Data/Analytics
    "big data analytics": "BDA",
    "data science": "DS",
    # Cloud/IoT
    "cloud computing": "CC",
    "internet of things": "IOT",
    # IT/Networking
    "information technology": "IT",
    "computer networking": "CN",
    # Software
    "software engineering": "SE",
    "software": "SE",
    # ECE variants
    "electronics and communication engineering": "ECE",
    "electronics and communication": "ECE",
    "electronics": "ECE",
    # EEE variants
    "electrical and electronics engineering": "EEE",
    "electrical and electronics": "EEE",
    "electrical engineering": "EE",
    "electrical": "EE",
    # Mechanical
    "mechanical engineering": "MECH",
    "mechanical": "MECH",
    "echanical": "MECH",  # Handle typo "M.Echanical"
    # Civil
    "civil engineering": "CIVIL",
    "civil": "CIVIL",
    # Aerospace/Auto
    "aerospace engineering": "AERO",
    "aerospace": "AERO",
    "automobile engineering": "AUTO",
    "automobile": "AUTO",
    # Bio
    "biotechnology": "BT",
    "biomedical engineering": "BME",
    "biomedical": "BME",
}

# Short abbreviations that should match as standalone words or at start
SHORT_ABBR_PREFIXES: dict[str, str] = {
    "cs ": "CS",
    "cs-": "CS",
    "it ": "IT",
    "it-": "IT",
    "ai ": "AI",
    "ai-": "AI",
    "ml ": "ML",
    "ml-": "ML",
    "ece": "ECE",
    "eee": "EEE",
    "cse": "CSE",
    "bda": "BDA",
    "iot": "IOT",
    "aiml": "AIML",
    "mech": "MECH",
    "aero": "AERO",
    "auto": "AUTO",
}


def _abbreviate_program(program: str) -> str:
    """Convert a program name to its abbreviation."""
    if not program:
        return ""

    program_clean = program.strip()
    program_lower = program_clean.lower()

    # Try to extract the main department/branch name
    # Common patterns: "B.Tech.-XXX", "B.Tech-XXX with specialization in YYY"

    # Remove degree prefix
    for prefix in [
            "b.tech.-",
            "b.tech-",
            "b.tech.",
            "b.tech ",
            "m.tech.-",
            "m.tech-",
            "m.tech.",
            "m.tech ",
            "m.tech (integrated)-",
            "m.tech(integrated)-",
            "b.e.-",
            "b.e-",
            "b.e.",
            "b.e ",
            "m.e.-",
            "m.e-",
            "m.e.",
            "m.e ",
    ]:
        if program_lower.startswith(prefix):
            program_lower = program_lower[len(prefix):]
            program_clean = program_clean[len(prefix):]
            break

    # Remove "with specialization in XXX" suffix - we want the main branch
    for suffix in [
            "with specialization in", "with specialisation in",
            "specialization in", "specialisation in"
    ]:
        if suffix in program_lower:
            idx = program_lower.find(suffix)
            program_lower = program_lower[:idx].strip()
            program_clean = program_clean[:idx].strip()
            break

    # Remove trailing dashes, spaces, parentheses
    program_lower = program_lower.rstrip("- ()")
    program_clean = program_clean.rstrip("- ()")

    # Also add a space at the end for short prefix matching
    program_lower_spaced = program_lower + " "

    # First check short prefix abbreviations (handles "CS ", "IT ", etc.)
    for prefix, abbr in SHORT_ABBR_PREFIXES.items():
        if program_lower_spaced.startswith(
                prefix) or program_lower == prefix.rstrip(" -"):
            return abbr

    # Check against known abbreviations (longer matches first for specificity)
    sorted_abbrs = sorted(PROGRAM_ABBREVIATIONS.items(),
                          key=lambda x: -len(x[0]))
    for key, abbr in sorted_abbrs:
        if key in program_lower:
            return abbr

    # If no match, try to create a short form from capitalized words
    # Only use alphanumeric characters
    words = ''.join(c if c.isalnum() or c.isspace() else ' '
                    for c in program_clean).split()

    # Filter out common prefixes and get capitals
    skip = {"b", "tech", "m", "of", "and", "in", "the", "with", "engineering"}
    caps = [
        w[0].upper() for w in words
        if w.lower() not in skip and len(w) > 1 and w[0].isalpha()
    ]
    if caps:
        return "".join(caps[:4])  # Max 4 letters

    # Last resort: return cleaned first word or first 6 chars
    words = program_clean.split()
    if words and words[0].isalpha():
        return words[0][:6].upper()

    return program_clean[:6].upper() if program_clean else "UNK"


def _format_programs(programs: list[str]) -> str:
    """Format a list of programs as abbreviated comma-separated string."""
    if not programs:
        return ""

    # Get unique abbreviations
    abbrs = []
    seen = set()
    for prog in programs:
        abbr = _abbreviate_program(prog)
        if abbr not in seen:
            abbrs.append(abbr)
            seen.add(abbr)

    return ", ".join(abbrs)


class SchedulerResult:
    """Result from running the scheduler."""

    def __init__(self) -> None:
        self.slot_assignments: dict[str, int] = {}  # section_id -> slot index
        self.solver_used: str = "none"
        self.solver_time_seconds: float = 0.0
        self.optimal: bool = False
        self.feasible: bool = False
        self.total_clash_weight: int = 0  # Sum of clash weights


@dataclass
class ConflictAnalysis:
    """Pre-analysis of conflicts for optimization."""
    critical_pairs: list[tuple[str, str,
                               int]]  # Must-separate pairs with high weight
    high_conflict_sections: list[str]  # Sections with most conflicts
    conflict_density: dict[str, int]  # Section -> total conflict weight
    color_lower_bound: int  # Minimum required slots (chromatic number estimate)


def analyze_conflicts(
    sections: list[Section],
    conflict_graph: ConflictGraph,
) -> ConflictAnalysis:
    """
    Pre-analyze conflict structure for better scheduling decisions.
    
    This identifies:
    - Critical pairs that must be separated (high clash weight)
    - High-conflict sections that need priority
    - Lower bound on required slots
    """
    # Build adjacency with weights
    conflict_density: dict[str, int] = defaultdict(int)
    adjacency: dict[str, set[str]] = defaultdict(set)

    for edge in conflict_graph.edges:
        conflict_density[edge.section_a] += edge.weight
        conflict_density[edge.section_b] += edge.weight
        adjacency[edge.section_a].add(edge.section_b)
        adjacency[edge.section_b].add(edge.section_a)

    # Find critical pairs (conflicts with large number of students)
    critical_pairs = [
        (e.section_a, e.section_b, e.weight) for e in conflict_graph.edges
        if e.weight >= 5  # 5+ students affected
    ]
    critical_pairs.sort(key=lambda x: -x[2])  # Highest weight first

    # High-conflict sections
    section_ids = [s.section_id for s in sections]
    high_conflict = sorted(section_ids,
                           key=lambda sid: conflict_density.get(sid, 0),
                           reverse=True)[:20]  # Top 20 most conflicting

    # Estimate chromatic number (max clique size as lower bound)
    # Use greedy clique finding
    max_clique_size = 1
    for sid in high_conflict[:10]:
        clique = {sid}
        neighbors = adjacency[sid]
        for other in high_conflict:
            if other != sid and other in neighbors:
                if all(other in adjacency[c] for c in clique):
                    clique.add(other)
        max_clique_size = max(max_clique_size, len(clique))

    return ConflictAnalysis(
        critical_pairs=critical_pairs[:50],  # Top 50 critical pairs
        high_conflict_sections=high_conflict,
        conflict_density=dict(conflict_density),
        color_lower_bound=max_clique_size,
    )


def solve_cpsat(
    sections: list[Section],
    conflict_graph: ConflictGraph,
    faculty_constraints: dict[str, list[str]],
    parallel_cap: Optional[int] = None,
    time_limit_seconds: int = DEFAULT_TIME_LIMIT_SECONDS,
) -> SchedulerResult:
    """
    Solve the scheduling problem using OR-Tools CP-SAT solver.
    
    Decision variables:
    - slot[s] ∈ {0..4} for each section s
    
    Hard constraints:
    - Faculty cannot teach two sections at the same time
    - At most `parallel_cap` sections per slot
    
    Soft constraints (minimized):
    - Student clashes: penalize when two sections sharing students are in same slot
    
    Args:
        sections: List of all sections to schedule
        conflict_graph: Graph with conflict edges between sections
        faculty_constraints: Map of faculty -> list of section_ids
        parallel_cap: Max sections per slot (auto-calculated if None)
        time_limit_seconds: Solver time limit
        
    Returns:
        SchedulerResult with slot assignments
    """
    # Auto-calculate parallel_cap if not provided
    if parallel_cap is None:
        parallel_cap = _calculate_parallel_cap(len(sections))

    result = SchedulerResult()
    result.solver_used = "cp-sat"

    # CpModel type stubs are incomplete, use Any for type checking
    model: Any = cp_model.CpModel()

    # Create section ID to index mapping
    section_ids = [s.section_id for s in sections]
    section_idx = {sid: i for i, sid in enumerate(section_ids)}

    # Track which sections are math courses (can use Saturday)
    section_is_math = {
        s.section_id: _is_math_course(s.course_code)
        for s in sections
    }

    # Decision variables: slot[i] = which day section i is scheduled
    # Math courses can use 0-5 (Mon-Sat), others use 0-4 (Mon-Fri)
    slot_vars = []
    for section in sections:
        max_slot = NUM_SLOTS_WITH_SATURDAY - 1 if section_is_math[
            section.section_id] else NUM_SLOTS - 1
        slot_vars.append(
            model.NewIntVar(0, max_slot, f"slot_{section.section_id}"))

    # =============== HARD CONSTRAINTS ===============

    # 1. Faculty constraints: sections taught by same faculty must be on different days
    for faculty, faculty_sections in faculty_constraints.items():
        if len(faculty_sections) > 1:
            faculty_slot_vars = [
                slot_vars[section_idx[sid]] for sid in faculty_sections
                if sid in section_idx
            ]
            # All different constraint
            model.AddAllDifferent(faculty_slot_vars)

    # 2. Parallel capacity: at most `parallel_cap` sections per slot
    # Include Saturday slot for completeness (only math courses can be there)
    for slot in range(NUM_SLOTS_WITH_SATURDAY):
        # Create boolean variables: is_in_slot[i] = 1 if section i is in this slot
        slot_bools = []
        for i, sid in enumerate(section_ids):
            is_in_slot = model.NewBoolVar(f"{sid}_in_slot_{slot}")
            model.Add(slot_vars[i] == slot).OnlyEnforceIf(is_in_slot)
            model.Add(slot_vars[i] != slot).OnlyEnforceIf(is_in_slot.Not())
            slot_bools.append(is_in_slot)

        # Sum of sections in this slot <= parallel_cap
        model.Add(sum(slot_bools) <= parallel_cap)

    # =============== SOFT CONSTRAINTS (OBJECTIVE) ===============

    # Pre-analyze conflicts
    analysis = analyze_conflicts(sections, conflict_graph)

    # Clash penalty: for each conflict edge, penalize if both sections same slot
    # Use quadratic scaling for large conflicts (affects many students = much worse)
    clash_penalties: list[cp_model.IntVar] = []

    for edge in conflict_graph.edges:
        if edge.section_a in section_idx and edge.section_b in section_idx:
            idx_a = section_idx[edge.section_a]
            idx_b = section_idx[edge.section_b]

            # Create boolean: same_slot = 1 if both sections in same slot
            same_slot = model.NewBoolVar(
                f"clash_{edge.section_a}_{edge.section_b}")
            model.Add(
                slot_vars[idx_a] == slot_vars[idx_b]).OnlyEnforceIf(same_slot)
            model.Add(slot_vars[idx_a] != slot_vars[idx_b]).OnlyEnforceIf(
                same_slot.Not())

            # Quadratic penalty for large conflicts
            if QUADRATIC_PENALTY and edge.weight >= 3:
                penalty_value = edge.weight * edge.weight  # Square for emphasis
            else:
                penalty_value = edge.weight

            penalty = model.NewIntVar(
                0, penalty_value, f"penalty_{edge.section_a}_{edge.section_b}")
            model.Add(penalty == penalty_value).OnlyEnforceIf(same_slot)
            model.Add(penalty == 0).OnlyEnforceIf(same_slot.Not())
            clash_penalties.append(penalty)

    # Add extra penalty for critical pairs (must-separate)
    for sec_a, sec_b, weight in analysis.critical_pairs[:20]:
        if sec_a in section_idx and sec_b in section_idx:
            idx_a = section_idx[sec_a]
            idx_b = section_idx[sec_b]
            # Force different slots for top critical pairs as soft constraint
            same = model.NewBoolVar(f"crit_{sec_a}_{sec_b}")
            model.Add(slot_vars[idx_a] == slot_vars[idx_b]).OnlyEnforceIf(same)
            model.Add(slot_vars[idx_a] != slot_vars[idx_b]).OnlyEnforceIf(
                same.Not())
            # Very high penalty
            extra_penalty = model.NewIntVar(0, weight * 10,
                                            f"crit_pen_{sec_a}_{sec_b}")
            model.Add(extra_penalty == weight * 10).OnlyEnforceIf(same)
            model.Add(extra_penalty == 0).OnlyEnforceIf(same.Not())
            clash_penalties.append(extra_penalty)

    # Load balance: minimize deviation from target sections per slot
    target_per_slot = len(sections) // NUM_SLOTS

    balance_penalties: list[cp_model.IntVar] = []
    for slot in range(NUM_SLOTS):
        count = model.NewIntVar(0, len(sections), f"count_slot_{slot}")
        slot_bools = []
        for i in range(len(section_ids)):
            is_in = model.NewBoolVar(f"s{i}_in_{slot}_bal")
            model.Add(slot_vars[i] == slot).OnlyEnforceIf(is_in)
            model.Add(slot_vars[i] != slot).OnlyEnforceIf(is_in.Not())
            slot_bools.append(is_in)
        model.Add(count == sum(slot_bools))

        # Deviation from target
        deviation = model.NewIntVar(0, len(sections), f"dev_slot_{slot}")
        model.AddAbsEquality(deviation, count - target_per_slot)
        balance_penalties.append(deviation)

    # Objective: minimize clashes (primary) + balance (secondary, lower weight)
    total_clash_penalty = sum(clash_penalties) if clash_penalties else 0
    total_balance_penalty = sum(balance_penalties)

    model.Minimize(CLASH_WEIGHT * total_clash_penalty +
                   BALANCE_WEIGHT * total_balance_penalty)

    # =============== SOLVE ===============

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = time_limit_seconds
    solver.parameters.num_search_workers = 8  # Parallel search
    solver.parameters.linearization_level = 2  # Better linear relaxation
    solver.parameters.cp_model_probing_level = 2  # More probing
    solver.parameters.search_branching = cp_model.AUTOMATIC_SEARCH

    start_time = time.time()
    status = solver.Solve(model)
    result.solver_time_seconds = time.time() - start_time

    if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        result.feasible = True
        result.optimal = status == cp_model.OPTIMAL

        # Extract solution
        for i, sid in enumerate(section_ids):
            result.slot_assignments[sid] = solver.Value(slot_vars[i])

        # Calculate actual clash weight (clash-only, not balance penalties)
        result.total_clash_weight = _compute_clash_weight(
            conflict_graph, result.slot_assignments)

    return result


def solve_greedy(
    sections: list[Section],
    conflict_graph: ConflictGraph,
    faculty_constraints: dict[str, list[str]],
    parallel_cap: Optional[int] = None,
    randomize: bool = False,
) -> SchedulerResult:
    """
    Advanced greedy graph-coloring with multi-factor prioritization.
    
    Strategy:
    1. Analyze conflict structure
    2. Sort sections by composite priority (conflicts + enrollment + constraints)
    3. Assign each section to slot with minimum weighted cost
    4. Apply local search refinement
    
    Args:
        sections: List of all sections to schedule
        conflict_graph: Graph with conflict edges
        faculty_constraints: Map of faculty -> section_ids
        parallel_cap: Max sections per slot (auto-calculated if None)
        randomize: Add randomization for multi-start
        
    Returns:
        SchedulerResult with slot assignments
    """
    # Auto-calculate parallel_cap if not provided
    if parallel_cap is None:
        parallel_cap = _calculate_parallel_cap(len(sections))

    result = SchedulerResult()
    result.solver_used = "greedy"

    start_time = time.time()

    # Pre-analyze conflicts
    analysis = analyze_conflicts(sections, conflict_graph)

    # Build adjacency list with weights
    adj: dict[str, dict[str, int]] = defaultdict(dict)
    for edge in conflict_graph.edges:
        adj[edge.section_a][edge.section_b] = edge.weight
        adj[edge.section_b][edge.section_a] = edge.weight

    # Multi-factor priority scoring
    def compute_priority(section: Section) -> float:
        sid = section.section_id
        conflict_weight = analysis.conflict_density.get(sid, 0)
        degree = len(adj[sid])  # Number of conflicts
        enrollment = section.enrollment_count

        # Higher score = higher priority (scheduled first)
        # Weight: conflict weight > degree > enrollment
        score = conflict_weight * 100 + degree * 10 + enrollment

        if randomize:
            score += random.uniform(-50, 50)  # Add noise for diversity

        return score

    sorted_sections = sorted(sections, key=compute_priority, reverse=True)

    # Track assignments and slot loads (include Saturday slot)
    assignments: dict[str, int] = {}
    slot_loads = [0] * NUM_SLOTS_WITH_SATURDAY

    # Track which sections are math courses (can use Saturday)
    math_sections: set[str] = {
        s.section_id
        for s in sections if _is_math_course(s.course_code)
    }

    # Build faculty -> assigned slots
    faculty_slots: dict[str, set[int]] = defaultdict(set)

    # Reverse map: section -> faculty
    section_faculty: dict[str, Optional[str]] = {}
    for faculty, sids in faculty_constraints.items():
        for sid in sids:
            section_faculty[sid] = faculty

    for section in sorted_sections:
        sid = section.section_id
        faculty = section_faculty.get(sid) or section.faculty

        # Math courses can use Saturday (slot 5), others can't
        max_slot = NUM_SLOTS_WITH_SATURDAY if sid in math_sections else NUM_SLOTS

        # Calculate target load for balancing
        total_assigned = sum(slot_loads[:max_slot])
        target_load = total_assigned / max_slot if max_slot > 0 else 0

        # Compute cost for each slot
        slot_costs = []
        for slot in range(max_slot):
            # Check faculty constraint
            if faculty and slot in faculty_slots.get(faculty, set()):
                cost = float('inf')  # Infeasible
            # Check parallel cap
            elif slot_loads[slot] >= parallel_cap:
                cost = float('inf')  # Infeasible
            else:
                # Cost = conflict cost + load balance penalty
                # Conflict cost: sum of conflict weights with sections already in this slot
                conflict_cost = 0
                for other_sid, assigned_slot in assignments.items():
                    if assigned_slot == slot and other_sid in adj[sid]:
                        conflict_cost += adj[sid][other_sid]

                # Load balance cost: penalize slots above average load
                # This encourages even distribution across days
                load_penalty = max(
                    0, slot_loads[slot] - target_load) * LOAD_BALANCE_FACTOR

                cost = conflict_cost + load_penalty

            slot_costs.append((cost, slot))

        # Choose slot with minimum cost (ties broken by slot number for determinism)
        slot_costs.sort(key=lambda x: (x[0], x[1]))
        best_cost, best_slot = slot_costs[0]

        if best_cost == float('inf'):
            # No feasible slot, pick least loaded (constraint violation)
            best_slot = min(range(max_slot), key=lambda s: slot_loads[s])

        assignments[sid] = best_slot
        slot_loads[best_slot] += 1

        if faculty:
            faculty_slots[faculty].add(best_slot)

    # Apply local search refinement
    assignments = local_search_improve(assignments, adj, faculty_constraints,
                                       slot_loads, parallel_cap, math_sections)

    result.slot_assignments = assignments
    result.feasible = True
    result.solver_time_seconds = time.time() - start_time

    # Calculate total clash weight (clash-only)
    result.total_clash_weight = _compute_clash_weight(conflict_graph,
                                                      assignments)

    return result


def local_search_improve(
    assignments: dict[str, int],
    adj: dict[str, dict[str, int]],
    faculty_constraints: dict[str, list[str]],
    slot_loads: list[int],
    parallel_cap: int,
    math_sections: set[str],
) -> dict[str, int]:
    """
    Local search to improve greedy solution.
    
    Tries swapping sections to reduce clashes.
    
    Args:
        math_sections: Set of section IDs that are math courses (can use Saturday)
    """
    # Build reverse map: section -> faculty
    section_faculty: dict[str, Optional[str]] = {}
    for faculty, sids in faculty_constraints.items():
        for sid in sids:
            section_faculty[sid] = faculty

    # Faculty slot assignments
    faculty_slots: dict[str, set[int]] = defaultdict(set)
    for sid, slot in assignments.items():
        faculty = section_faculty.get(sid)
        if faculty:
            faculty_slots[faculty].add(slot)

    def compute_clash_cost(sid: str, slot: int) -> int:
        """Cost of placing section in slot."""
        cost = 0
        for other_sid, weight in adj[sid].items():
            if assignments.get(other_sid) == slot:
                cost += weight
        return cost

    def is_move_feasible(sid: str, new_slot: int) -> bool:
        """Check if moving section to new slot is feasible."""
        faculty = section_faculty.get(sid)
        old_slot = assignments[sid]

        # Check faculty constraint
        if faculty:
            other_faculty_sections = [
                s for s, f in section_faculty.items()
                if f == faculty and s != sid
            ]
            for other in other_faculty_sections:
                if assignments.get(other) == new_slot:
                    return False

        # Check parallel cap
        if slot_loads[new_slot] >= parallel_cap and slot_loads[
                old_slot] > slot_loads[new_slot]:
            return False

        return True

    # Iterative improvement
    improved = True
    iterations = 0

    while improved and iterations < LOCAL_SEARCH_ITERATIONS:
        improved = False
        iterations += 1

        # Try moving each section to a better slot
        for sid in list(assignments.keys()):
            current_slot = assignments[sid]
            current_cost = compute_clash_cost(sid, current_slot)

            if current_cost == 0:
                continue  # Already optimal for this section

            # Math courses can use Saturday (slot 5), others can't
            max_slot = NUM_SLOTS_WITH_SATURDAY if sid in math_sections else NUM_SLOTS

            # Try each alternative slot
            best_slot = current_slot
            best_cost = current_cost

            for new_slot in range(max_slot):
                if new_slot == current_slot:
                    continue

                if not is_move_feasible(sid, new_slot):
                    continue

                new_cost = compute_clash_cost(sid, new_slot)
                if new_cost < best_cost:
                    best_cost = new_cost
                    best_slot = new_slot

            # Make the move if beneficial
            if best_slot != current_slot:
                # Update slot loads
                slot_loads[current_slot] -= 1
                slot_loads[best_slot] += 1

                # Update faculty slots
                faculty = section_faculty.get(sid)
                if faculty:
                    faculty_slots[faculty].discard(current_slot)
                    faculty_slots[faculty].add(best_slot)

                assignments[sid] = best_slot
                improved = True

    return assignments


def solve_greedy_multi_start(
    sections: list[Section],
    conflict_graph: ConflictGraph,
    faculty_constraints: dict[str, list[str]],
    parallel_cap: Optional[int] = None,
    num_runs: int = MULTI_START_RUNS,
) -> SchedulerResult:
    """
    Run greedy algorithm multiple times with randomization and keep best.
    """
    # Auto-calculate parallel_cap if not provided
    if parallel_cap is None:
        parallel_cap = _calculate_parallel_cap(len(sections))

    start_time = time.time()
    best_result: Optional[SchedulerResult] = None

    for i in range(num_runs):
        result = solve_greedy(
            sections,
            conflict_graph,
            faculty_constraints,
            parallel_cap,
            randomize=(i > 0)  # First run deterministic
        )

        if best_result is None or result.total_clash_weight < best_result.total_clash_weight:
            best_result = result

    # Track total time across all runs
    if best_result:
        best_result.solver_time_seconds = time.time() - start_time

    return best_result or SchedulerResult()


def run_scheduler(
    course_sections: dict[str, list[Section]],
    conflict_graph: ConflictGraph,
    faculty_constraints: dict[str, list[str]],
    parallel_cap: Optional[int] = None,
    time_limit_seconds: int = DEFAULT_TIME_LIMIT_SECONDS,
    use_greedy_only: bool = False,
) -> SchedulerResult:
    """
    Run the scheduler with CP-SAT, falling back to improved greedy if needed.
    
    Algorithm strategy:
    1. Try CP-SAT solver (optimal solution)
    2. If CP-SAT fails/timeout, use multi-start greedy with local search
    3. Compare solutions and return best
    
    Args:
        course_sections: Dict of course_code -> list of Section
        conflict_graph: Conflict graph
        faculty_constraints: Faculty -> section mappings
        parallel_cap: Max sections per slot (auto-calculated if None)
        time_limit_seconds: CP-SAT time limit
        use_greedy_only: Skip CP-SAT and use greedy directly
        
    Returns:
        SchedulerResult with solution
    """
    total_start_time = time.time()
    sections = get_all_sections(course_sections)

    # Auto-calculate parallel_cap if not provided
    if parallel_cap is None:
        parallel_cap = _calculate_parallel_cap(len(sections))

    if use_greedy_only:
        result = solve_greedy_multi_start(sections, conflict_graph,
                                          faculty_constraints, parallel_cap)
        result.solver_time_seconds = time.time() - total_start_time
        return result

    # Try CP-SAT first
    result = solve_cpsat(sections, conflict_graph, faculty_constraints,
                         parallel_cap, time_limit_seconds)

    if result.feasible:
        # Also try greedy and compare
        greedy_result = solve_greedy_multi_start(sections, conflict_graph,
                                                 faculty_constraints,
                                                 parallel_cap)

        # Return the better solution (primary: minimum clashes)
        if greedy_result.total_clash_weight < result.total_clash_weight:
            greedy_result.solver_used = "greedy (fewer clashes than cp-sat)"
            greedy_result.solver_time_seconds = time.time() - total_start_time
            return greedy_result

        result.solver_time_seconds = time.time() - total_start_time
        return result

    # Fall back to greedy
    result = solve_greedy_multi_start(sections, conflict_graph,
                                      faculty_constraints, parallel_cap)
    result.solver_time_seconds = time.time() - total_start_time
    return result


def build_schedule(
    course_sections: dict[str, list[Section]],
    scheduler_result: SchedulerResult,
) -> Schedule:
    """
    Convert scheduler result to Schedule with human-readable output.
    
    Args:
        course_sections: Dict of course_code -> list of Section
        scheduler_result: Result from scheduler
        
    Returns:
        Schedule with entries
    """
    entries: list[ScheduleEntry] = []

    for sections in course_sections.values():
        for section in sections:
            slot_idx = scheduler_result.slot_assignments.get(
                section.section_id, 0)
            day = INDEX_TO_DAY[slot_idx]

            # Format programs as abbreviated comma-separated list
            programs_str = _format_programs(section.programs)

            entries.append(
                ScheduleEntry(
                    section_id=section.section_id,
                    course_code=section.course_code,
                    course_title=section.course_title,
                    section_number=section.section_number,
                    day=day,
                    time="5:00 PM - 7:00 PM",
                    faculty=section.faculty,
                    enrollment_count=section.enrollment_count,
                    programs=programs_str,
                ))

    # Sort by day, then course code
    entries.sort(key=lambda e: (e.day.value, e.course_code, e.section_number))

    return Schedule(
        entries=entries,
        total_sections=len(entries),
        solver_used=scheduler_result.solver_used,
        solver_time_seconds=scheduler_result.solver_time_seconds,
    )


def compute_clash_report(
    students: dict[str, Student],
    course_sections: dict[str, list[Section]],
    scheduler_result: SchedulerResult,
) -> ClashReport:
    """
    Compute clash report for all students.
    
    Args:
        students: Dict of register_number -> Student
        course_sections: Dict of course_code -> list of Section
        scheduler_result: Result from scheduler
        
    Returns:
        ClashReport with per-student status
    """
    # Build student -> their sections mapping
    student_sections_map: dict[str, list[str]] = defaultdict(list)

    for sections in course_sections.values():
        for section in sections:
            for student_id in section.enrolled_students:
                student_sections_map[student_id].append(section.section_id)

    reports: list[StudentClashReport] = []
    students_with_clashes = 0

    for student_id, student in students.items():
        section_ids = student_sections_map.get(student_id, [])

        # Group sections by slot
        slot_sections: dict[int, list[str]] = defaultdict(list)
        for sid in section_ids:
            slot = scheduler_result.slot_assignments.get(sid, -1)
            slot_sections[slot].append(sid)

        # Find clashes (slots with >1 section)
        clashing_pairs: list[tuple[str, str]] = []
        clashing_day: Optional[Day] = None

        for slot, sids in slot_sections.items():
            if len(sids) > 1 and slot >= 0:
                # Extract course codes from section IDs
                courses = [
                    sid.split("_S")[0] if "_S" in sid else sid for sid in sids
                ]
                for i in range(len(courses)):
                    for j in range(i + 1, len(courses)):
                        clashing_pairs.append((courses[i], courses[j]))
                clashing_day = INDEX_TO_DAY.get(slot)

        status = ClashStatus.RED if clashing_pairs else ClashStatus.GREEN
        if clashing_pairs:
            students_with_clashes += 1

        reports.append(
            StudentClashReport(
                register_number=student_id,
                student_name=student.name,
                program=student.program,
                enrolled_courses=student.enrolled_courses,
                status=status,
                clashing_courses=clashing_pairs,
                clashing_day=clashing_day,
            ))

    # Sort: Red students first, then by register number
    reports.sort(
        key=lambda r: (r.status != ClashStatus.RED, r.register_number))

    total = len(reports)
    return ClashReport(
        total_students=total,
        students_with_clashes=students_with_clashes,
        clash_free_students=total - students_with_clashes,
        clash_percentage=round(students_with_clashes / total *
                               100, 2) if total > 0 else 0.0,
        reports=reports,
    )


# ============================================================================
# PRE-SORTED SCHEDULE ANALYSIS
# ============================================================================


@dataclass
class ClashSuggestion:
    """A suggestion for resolving a clash."""
    course_to_move: str
    current_day: str
    suggested_day: str
    students_affected: int
    reason: str


@dataclass
class PresortedAnalysis:
    """Analysis of a pre-sorted schedule."""
    total_clashes: int
    students_affected: int
    clash_details: list[dict]  # Details of each clash
    suggestions: list[ClashSuggestion]
    by_course: dict[str, list[dict]]  # course -> clashes involving it
    by_day: dict[str, int]  # day -> number of clashes


def analyze_presorted_schedule_clashes(
    students: Optional[dict[str, Student]] = None,
    presorted_schedule=None,  # PresortedSchedule from parser
    course_sections: Optional[dict[str, list[Section]]] = None,
) -> PresortedAnalysis:
    """
    Analyze a pre-sorted schedule for clashes and suggest improvements.
    
    This takes a faculty-created schedule (with day/slot assignments)
    and finds all student clashes, then suggests optimal swaps.
    
    Args:
        students: Dict of register_number -> Student (optional if schedule has embedded students)
        presorted_schedule: PresortedSchedule from parser
        course_sections: Optional section info for better suggestions
        
    Returns:
        PresortedAnalysis with clash details and suggestions
    """
    if presorted_schedule is None:
        return PresortedAnalysis(
            total_clashes=0,
            students_affected=0,
            clash_details=[],
            suggestions=[],
            by_course={},
            by_day={},
        )

    course_day_map = presorted_schedule.course_day_map
    day_slot_map = presorted_schedule.day_slot_map

    # Use provided students or extract from presorted_schedule
    student_data: dict = {}
    if students:
        student_data = students
    elif hasattr(presorted_schedule,
                 'students') and presorted_schedule.students:
        # Convert PresortedStudent to a compatible format
        student_data = {
            reg:
            type(
                'Student', (), {
                    'enrolled_courses': s.enrolled_courses,
                    'name': s.name,
                    'program': s.program,
                    'register_number': s.register_number,
                })()
            for reg, s in presorted_schedule.students.items()
        }

    if not student_data:
        return PresortedAnalysis(
            total_clashes=0,
            students_affected=0,
            clash_details=[],
            suggestions=[],
            by_course={},
            by_day={},
        )

    clash_details: list[dict] = []
    by_course: dict[str, list[dict]] = defaultdict(list)
    by_day: dict[str, int] = defaultdict(int)
    affected_students: set[str] = set()

    # Check each student for clashes
    for student_id, student in student_data.items():
        courses = student.enrolled_courses

        # Group courses by day
        day_courses: dict[str, list[str]] = defaultdict(list)
        for course in courses:
            if course in course_day_map:
                day = course_day_map[course]
                day_courses[day].append(course)

        # Find clashes (multiple courses same day)
        for day, courses_on_day in day_courses.items():
            if len(courses_on_day) > 1:
                affected_students.add(student_id)

                for i in range(len(courses_on_day)):
                    for j in range(i + 1, len(courses_on_day)):
                        clash = {
                            "student_id": student_id,
                            "student_name": student.name,
                            "program": student.program,
                            "course_a": courses_on_day[i],
                            "course_b": courses_on_day[j],
                            "day": day,
                        }
                        clash_details.append(clash)
                        by_course[courses_on_day[i]].append(clash)
                        by_course[courses_on_day[j]].append(clash)
                        by_day[day] += 1

    # Generate improvement suggestions
    suggestions: list[ClashSuggestion] = []

    # Analyze which courses have the most clashes
    course_clash_count = {
        course: len(clashes)
        for course, clashes in by_course.items()
    }

    # Sort by clash count
    problematic_courses = sorted(course_clash_count.items(),
                                 key=lambda x: -x[1])[:10]

    # For each problematic course, suggest a better day
    # Use actual days from the schedule, not hardcoded "Day 1", "Day 2" etc.
    used_days = set(course_day_map.values())
    # If schedule uses actual day names, use those; otherwise use standard weekdays
    standard_days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]
    if used_days and any(d in standard_days for d in used_days):
        all_days = [
            d for d in standard_days if d in used_days or d not in used_days
        ]
        # Include all standard days for potential alternatives
        all_days = standard_days
    else:
        # Schedule might use "Day 1", "Day 2" format - extract from schedule
        all_days = sorted(used_days) if used_days else standard_days

    for course, clash_count in problematic_courses:
        if clash_count == 0:
            continue

        current_day = course_day_map.get(course, "Unknown")

        # Find day with least conflicts for this course
        day_conflict_count: dict[str, int] = {}

        for day in all_days:
            if day == current_day:
                continue

            # Count how many students would still have clashes on this day
            conflicts = 0
            for clash in by_course[course]:
                student_id = clash["student_id"]
                student = student_data.get(student_id)
                if student:
                    for other_course in student.enrolled_courses:
                        if other_course != course and course_day_map.get(
                                other_course) == day:
                            conflicts += 1
                            break

            day_conflict_count[day] = conflicts

        # Find best alternative day
        if day_conflict_count:
            best_day = min(day_conflict_count.items(), key=lambda x: x[1])
            if best_day[1] < clash_count:
                suggestions.append(
                    ClashSuggestion(
                        course_to_move=course,
                        current_day=current_day,
                        suggested_day=best_day[0],
                        students_affected=clash_count - best_day[1],
                        reason=
                        f"Reduces clashes from {clash_count} to {best_day[1]}")
                )

    # Sort suggestions by impact
    suggestions.sort(key=lambda s: -s.students_affected)

    return PresortedAnalysis(
        total_clashes=len(clash_details),
        students_affected=len(affected_students),
        clash_details=clash_details,
        suggestions=suggestions[:10],  # Top 10 suggestions
        by_course=dict(by_course),
        by_day=dict(by_day),
    )


def _get_presorted_student_data(
    students: Optional[dict[str, Student]],
    presorted_schedule,
) -> dict[str, Any]:
    if students:
        return students
    if hasattr(presorted_schedule, 'students') and presorted_schedule.students:
        return {
            reg:
            type(
                'Student', (), {
                    'enrolled_courses': s.enrolled_courses,
                    'name': s.name,
                    'program': s.program,
                    'register_number': s.register_number,
                })()
            for reg, s in presorted_schedule.students.items()
        }
    return {}


def _build_course_conflicts(
        student_data: dict[str, Any]) -> dict[tuple[str, str], int]:
    conflicts: dict[tuple[str, str], int] = defaultdict(int)
    for student in student_data.values():
        courses = [c for c in getattr(student, 'enrolled_courses', []) if c]
        for i in range(len(courses)):
            for j in range(i + 1, len(courses)):
                a = courses[i]
                b = courses[j]
                if a == b:
                    continue
                key = (a, b) if a < b else (b, a)
                conflicts[key] += 1
    return conflicts


def optimize_presorted_schedule(
    students: dict[str, Student],
    presorted_schedule,
    time_limit_seconds: int = 120,
) -> tuple[dict[str, str], PresortedAnalysis]:
    """
    Attempt to optimize a pre-sorted schedule with limited changes.
    
    Minimizes clashes first, then minimizes the number of moved courses.
    
    Returns:
        Tuple of (optimized day assignments, analysis of optimized schedule)
    """
    from unislot.parser import PresortedSchedule

    course_day_map = dict(presorted_schedule.course_day_map)

    student_data = _get_presorted_student_data(students, presorted_schedule)
    if not student_data or not course_day_map:
        final_analysis = analyze_presorted_schedule_clashes(
            students, presorted_schedule)
        return course_day_map, final_analysis

    conflicts = _build_course_conflicts(student_data)

    day_order = [
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday",
        "Sunday",
    ]

    if getattr(presorted_schedule, 'course_day_options', None):
        all_days = sorted(
            {
                d
                for days in presorted_schedule.course_day_options.values()
                for d in days
            },
            key=lambda d: day_order.index(d) if d in day_order else 99)
    else:
        all_days = sorted(set(course_day_map.values()),
                          key=lambda d: day_order.index(d)
                          if d in day_order else 99)

    if not all_days:
        all_days = day_order[:5]

    day_to_idx = {day: i for i, day in enumerate(all_days)}

    model: Any = cp_model.CpModel()
    course_vars: dict[str, Any] = {}

    for course in sorted(course_day_map.keys()):
        allowed_days = None
        if getattr(presorted_schedule, 'course_day_options', None):
            allowed_days = presorted_schedule.course_day_options.get(course)
        allowed_idx = [
            day_to_idx[d] for d in (allowed_days or all_days)
            if d in day_to_idx
        ]
        if not allowed_idx:
            allowed_idx = list(day_to_idx.values())
        domain = cp_model.Domain.FromValues(allowed_idx)
        course_vars[course] = model.NewIntVarFromDomain(
            domain, f"course_{course}")

    clash_penalties: list[Any] = []
    for (course_a, course_b), weight in conflicts.items():
        if course_a not in course_vars or course_b not in course_vars:
            continue
        same_day = model.NewBoolVar(f"clash_{course_a}_{course_b}")
        model.Add(course_vars[course_a] ==
                  course_vars[course_b]).OnlyEnforceIf(same_day)
        model.Add(
            course_vars[course_a] != course_vars[course_b]).OnlyEnforceIf(
                same_day.Not())
        penalty = model.NewIntVar(0, weight, f"penalty_{course_a}_{course_b}")
        model.Add(penalty == weight).OnlyEnforceIf(same_day)
        model.Add(penalty == 0).OnlyEnforceIf(same_day.Not())
        clash_penalties.append(penalty)

    move_bools: list[Any] = []
    for course, var in course_vars.items():
        original_day = course_day_map.get(course)
        if original_day not in day_to_idx:
            continue
        moved = model.NewBoolVar(f"moved_{course}")
        model.Add(var != day_to_idx[original_day]).OnlyEnforceIf(moved)
        model.Add(var == day_to_idx[original_day]).OnlyEnforceIf(moved.Not())
        move_bools.append(moved)

    total_clash_penalty = sum(clash_penalties) if clash_penalties else 0
    total_moves = sum(move_bools) if move_bools else 0

    model.Minimize(1000 * total_clash_penalty + total_moves)

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = time_limit_seconds
    solver.parameters.num_search_workers = 8

    status = solver.Solve(model)

    if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        for course, var in course_vars.items():
            idx = solver.Value(var)
            if 0 <= idx < len(all_days):
                course_day_map[course] = all_days[idx]

    final_mock = PresortedSchedule(
        entries=presorted_schedule.entries,
        day_slot_map=presorted_schedule.day_slot_map,
        course_day_map=course_day_map,
        course_slot_map=presorted_schedule.course_slot_map,
        students=getattr(presorted_schedule, 'students', None),
        course_day_options=getattr(presorted_schedule, 'course_day_options',
                                   None),
        course_day_pairs=getattr(presorted_schedule, 'course_day_pairs', None),
        original_df=getattr(presorted_schedule, 'original_df', None),
    )

    final_analysis = analyze_presorted_schedule_clashes(students, final_mock)

    return course_day_map, final_analysis

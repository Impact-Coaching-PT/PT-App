// ═══════════════════════════════════════════════════════════════════
// IMPACT COACHING — AUTO WORKOUT GENERATOR
// Standalone module, loaded by index.html via <script src="workout-generator.js">
//
// Depends on globals already defined in index.html:
//   EX_BUILTIN, DB, B, SCHEMES, allExercises(), getExercise(), uid(),
//   renderSlots(), toast(), TEMPLATES
//
// Public entry point: window.autoGenerateWorkout()
// Called by the "🎲 Auto-Fill" button on the Build Session page.
// ═══════════════════════════════════════════════════════════════════

(function () {

  // ── Movement pattern inference ─────────────────────────────────────
  // We don't re-tag the 357-exercise library by hand. Instead we infer
  // a movement pattern from the existing cat + muscle tags + name
  // keywords already on every entry. Keeps the library single-source.
  const UNILATERAL_KEYWORDS = [
    "single", "bulgarian", "step up", "split squat", "curtsy",
    "lateral lunge", "reverse lunge", "step down", "single leg",
    "single arm", "forward lunge", "walking lunge"
  ];
  const COMPOUND_KEYWORDS = [
    "squat", "deadlift", "bench press", "press", "rdl", "romanian",
    "hip thrust", "glute bridge", "row"
  ];
  const ISOLATION_KEYWORDS = [
    "curl", "raise", "extension", "fly", "pushdown", "kickback",
    "shrug", "crunch", "ext"
  ];
  const POSTERIOR_MUSCLES = ["Hamstrings", "Glutes", "Lats", "Upper Back"];

  function inferPattern(ex) {
    const n = ex.name.toLowerCase();
    if (ex.cat === "combination" || ex.cat === "cardio") return "finisher";

    const isIsolationWord = ISOLATION_KEYWORDS.some(k => n.includes(k));
    if (UNILATERAL_KEYWORDS.some(k => n.includes(k))) return "unilateral";
    if (COMPOUND_KEYWORDS.some(k => n.includes(k)) && !isIsolationWord) return "compound";
    if ((ex.m || []).some(m => POSTERIOR_MUSCLES.includes(m))) return "posterior";
    return "isolation";
  }

  // ── Equipment type inference ───────────────────────────────────────
  // Same approach: infer from existing name keywords, no re-tagging needed.
  // "Soft" focus — used as a scoring bias, never a hard filter, so a slot
  // never comes up empty just because the gym's missing a specific machine.
  const EQUIP_KEYWORDS = {
    pinplate: ["pin", "plate", "smith", "belt squat", "leg press", "hack squat", "machine", "extension", "curl (pin)", "curl (plate)"],
    cable:    ["cable"],
    free:     ["db ", " db", "kb ", " kb", "dumbbell", "kettlebell", "bb ", " bb", "barbell"],
    bodyweight: ["press up", "plank", "pull up", "pull ups", "chin up", "dip", "crunch", "sit up", "mountain climber", "burpee", "bear crawl", "superman", "hold", "v sit", "bird dog", "dead bug", "wall sit"],
  };

  function inferEquipment(ex) {
    const n = ex.name.toLowerCase();
    if (EQUIP_KEYWORDS.pinplate.some(k => n.includes(k))) return "pinplate";
    if (EQUIP_KEYWORDS.cable.some(k => n.includes(k))) return "cable";
    if (EQUIP_KEYWORDS.free.some(k => n.includes(k))) return "free";
    if (EQUIP_KEYWORDS.bodyweight.some(k => n.includes(k))) return "bodyweight";
    // Common unlabelled barbell compound lifts default to "free" (your gym's convention)
    const BARBELL_DEFAULT = ["squat", "deadlift", "bench press", "bent over row", "rack pull", "rdl", "romanian", "hip thrust", "lunge"];
    if (BARBELL_DEFAULT.some(k => n.includes(k))) return "free";
    return "other";
  }

  // ── Difficulty profiles ──────────────────────────────────────────
  // Controls both movement complexity (which patterns/cats are allowed)
  // and load/intensity (which scheme pool is used + how many finishers).
  const DIFFICULTY = {
    beginner: {
      label: "Beginner",
      allowUnilateral: false,
      allowCombination: false,
      allowFinisherSlot: false,
      schemePool: ["Strength", "High Rep"], // simple, flat set/rep — no supersets/drops
      preferSchemes: ["3×12", "3×10", "3×15", "10×3", "12×3", "15×3"],
    },
    intermediate: {
      label: "Intermediate",
      allowUnilateral: true,
      allowCombination: true,
      allowFinisherSlot: true,
      schemePool: ["Strength", "High Rep", "Supersets", "Pyramid"],
      preferSchemes: null, // any from schemePool groups
    },
    advanced: {
      label: "Advanced",
      allowUnilateral: true,
      allowCombination: true,
      allowFinisherSlot: true,
      schemePool: ["Strength", "Drop Sets", "Supersets", "Pyramid", "Failure"],
      preferSchemes: null,
    },
  };

  // ── Slot structure per session category ──────────────────────────
  // Each session type gets a fixed pattern of roles to fill, in order.
  // "any" patterns just mean: pick from the category pool, pattern-agnostic.
  const SESSION_STRUCTURE = {
    legs: [
      { role: "compound",   patterns: ["compound"] },
      { role: "unilateral", patterns: ["unilateral"], minDifficulty: "intermediate" },
      { role: "posterior",  patterns: ["posterior", "compound"] },
      { role: "accessory",  patterns: ["isolation", "unilateral"] },
      { role: "finisher",   patterns: ["finisher"], minDifficulty: "intermediate" },
    ],
    chest: [ // Chest, Tris & Shoulders
      { role: "compound",   patterns: ["compound"], catOverride: "chest" },
      { role: "accessory",  patterns: ["isolation", "compound"], catOverride: "chest" },
      { role: "shoulders",  patterns: ["compound", "isolation"], catOverride: "shoulders" },
      { role: "triceps",    patterns: ["isolation"], catOverride: "arms", muscleFilter: ["Triceps"] },
      { role: "finisher",   patterns: ["finisher"], minDifficulty: "intermediate" },
    ],
    back: [ // Back & Biceps
      { role: "compound",   patterns: ["compound", "posterior"], catOverride: "back" },
      { role: "posterior",  patterns: ["posterior"], catOverride: "back" },
      { role: "unilateral", patterns: ["unilateral"], catOverride: "back", minDifficulty: "intermediate" },
      { role: "biceps",     patterns: ["isolation"], catOverride: "arms", muscleFilter: ["Biceps"] },
      { role: "finisher",   patterns: ["finisher"], minDifficulty: "intermediate" },
    ],
    full: [ // Full Body
      { role: "lower-compound", patterns: ["compound"], catOverride: "legs" },
      { role: "upper-push",     patterns: ["compound", "isolation"], catOverride: "chest" },
      { role: "upper-pull",     patterns: ["compound", "posterior"], catOverride: "back" },
      { role: "unilateral-leg", patterns: ["unilateral"], catOverride: "legs", minDifficulty: "intermediate" },
      { role: "core",           patterns: ["isolation", "compound"], catOverride: "core" },
      { role: "finisher",       patterns: ["finisher"], minDifficulty: "intermediate" },
    ],
    upper: [ // Upper Body
      { role: "push-compound", patterns: ["compound"], catOverride: "chest" },
      { role: "pull-compound", patterns: ["compound", "posterior"], catOverride: "back" },
      { role: "shoulders",     patterns: ["compound", "isolation"], catOverride: "shoulders" },
      { role: "arms",          patterns: ["isolation"], catOverride: "arms" },
      { role: "finisher",      patterns: ["finisher"], minDifficulty: "intermediate" },
    ],
    lower: [ // Lower Body — maps onto the real "legs" category in the library
      { role: "compound",   patterns: ["compound"], catOverride: "legs" },
      { role: "unilateral", patterns: ["unilateral"], catOverride: "legs", minDifficulty: "intermediate" },
      { role: "posterior",  patterns: ["posterior"], catOverride: "legs" },
      { role: "accessory",  patterns: ["isolation"], catOverride: "legs" },
      { role: "core",       patterns: ["isolation", "compound"], catOverride: "core" },
      { role: "finisher",   patterns: ["finisher"], minDifficulty: "intermediate" },
    ],
  };

  const DIFFICULTY_ORDER = ["beginner", "intermediate", "advanced"];
  function meetsMinDifficulty(min, current) {
    if (!min) return true;
    return DIFFICULTY_ORDER.indexOf(current) >= DIFFICULTY_ORDER.indexOf(min);
  }

  // ── Scheme picking ──────────────────────────────────────────────
  function pickScheme(diffProfile, isFinisher) {
    const allSchemes = Object.assign({}, SCHEMES, DB.customSchemes || {});
    if (isFinisher) {
      // Finishers favour cardio/sled-style schemes when available, else fall back
      const pool = allSchemes["Cardio"] || allSchemes["Sled/Track"] || diffProfile.schemePool;
      if (Array.isArray(pool) && typeof pool[0] === "string" && allSchemes["Cardio"]) {
        return pool[Math.floor(Math.random() * pool.length)];
      }
    }
    if (diffProfile.preferSchemes) {
      return diffProfile.preferSchemes[Math.floor(Math.random() * diffProfile.preferSchemes.length)];
    }
    const groupKey = diffProfile.schemePool[Math.floor(Math.random() * diffProfile.schemePool.length)];
    const group = allSchemes[groupKey];
    if (!group || !group.length) return "3×12";
    return group[Math.floor(Math.random() * group.length)];
  }

  // ── Core selection logic ─────────────────────────────────────────
  function pickExerciseForSlot(slotDef, sessionCat, diffProfile, usedNames, usedMuscles, muscleFocus, equipFocus) {
    // Finisher slots are special: combination/cardio exercises live under their
    // own cat tags ("combination"/"cardio"), never under the session's own cat
    // (e.g. "legs"), so they must search across both regardless of catOverride.
    const isFinisherRole = slotDef.patterns.length === 1 && slotDef.patterns[0] === "finisher";
    const targetCat = slotDef.catOverride || sessionCat;

    const pool = allExercises().filter(ex => {
      if (usedNames.has(ex.name)) return false;
      if (isFinisherRole) {
        if (ex.cat !== "combination" && ex.cat !== "cardio") return false;
        if (ex.cat === "combination" && !diffProfile.allowCombination) return false;
      } else {
        if (ex.cat !== targetCat) return false;
        const pattern = inferPattern(ex);
        if (!slotDef.patterns.includes(pattern)) return false;
        if (pattern === "unilateral" && !diffProfile.allowUnilateral) return false;
      }
      if (slotDef.muscleFilter && !(ex.m || []).some(m => slotDef.muscleFilter.includes(m))) return false;
      return true;
    });

    if (!pool.length) return null;

    // Weighted scoring — lower score wins. Three soft factors combined:
    //  1. Muscle-overlap-avoidance: penalise muscles already hit this session,
    //     so coverage spreads rather than stacking one group repeatedly.
    //  2. Muscle Focus bonus: strongly reward exercises matching the chosen
    //     focus (e.g. Quad Focus), reduced on posterior/core/finisher roles
    //     so balance work still gets in.
    //  3. Equipment Focus bonus: soft preference only — never excludes,
    //     just nudges selection toward the requested equipment type.
    const focusMuscles = (muscleFocus && MUSCLE_FOCUS[muscleFocus]) || null;
    const focusWeight = REDUCED_FOCUS_ROLES.includes(slotDef.role) ? 1 : 3;

    const scored = pool.map(ex => {
      const overlapPenalty = (ex.m || []).filter(m => usedMuscles.has(m)).length;
      let focusBonus = 0;
      if (focusMuscles && (ex.m || []).some(m => focusMuscles.includes(m))) focusBonus = -focusWeight;
      let equipBonus = 0;
      if (equipFocus && equipFocus !== "any" && inferEquipment(ex) === equipFocus) equipBonus = -1;
      const score = overlapPenalty + focusBonus + equipBonus;
      return { ex, score };
    });
    scored.sort((a, b) => a.score - b.score);
    const minScore = scored[0].score;
    const best = scored.filter(s => s.score === minScore).map(s => s.ex);
    return best[Math.floor(Math.random() * best.length)];
  }

  // ── Muscle Focus map ────────────────────────────────────────────
  // Which muscle tags count as "the focus" for each selectable option.
  // Weighted, not strict — posterior/balance-type slot roles get a
  // reduced bonus so a Quad Focus leg day still includes real hamstring/
  // glute posterior-chain work rather than becoming quad-only.
  const MUSCLE_FOCUS = {
    quad:      ["Quads"],
    glute:     ["Glutes"],
    hamstring: ["Hamstrings"],
    chestf:    ["Chest"],
    shoulderf: ["Shoulders"],
    tricepf:   ["Triceps"],
    backf:     ["Lats", "Upper Back"],
    bicepf:    ["Biceps"],
  };
  // Slot roles where the muscle-focus bonus is dialled down, so the
  // session still gets balanced posterior-chain / stability work even
  // when a strong focus is selected.
  const REDUCED_FOCUS_ROLES = ["posterior", "core", "finisher"];


  // Reads the current Build Session form state (B.cat, B.template, difficulty
  // selector), fills B.rows in place to match the template's slot COUNT,
  // and re-renders. Name/notes are left untouched per Ritchie's spec.
  window.autoGenerateWorkout = function () {
    const catSelect = document.getElementById("b-cat");
    const diffSelect = document.getElementById("b-difficulty");
    const focusSelect = document.getElementById("b-focus");
    const equipSelect = document.getElementById("b-equip");
    const sessionCat = catSelect ? catSelect.value : "legs";
    const difficulty = diffSelect ? diffSelect.value : "intermediate";
    const muscleFocus = focusSelect ? focusSelect.value : "";
    const equipFocus = equipSelect ? equipSelect.value : "any";
    const diffProfile = DIFFICULTY[difficulty] || DIFFICULTY.intermediate;

    if (sessionCat === "custom") {
      toast("Pick a real category first (not Custom) to auto-generate");
      return;
    }

    const structure = SESSION_STRUCTURE[sessionCat];
    if (!structure) {
      toast("No generator pattern for this category yet");
      return;
    }

    const tDef = TEMPLATES[B.template] || TEMPLATES.strength1hr;
    const slotCount = (tDef.slots || []).length || 6;

    // Build the working slot list: take the structure roles in order,
    // looping back to the start if the template wants more slots than
    // we have defined roles for (e.g. an 8-slot template on a 5-role structure).
    const activeStructure = structure.filter(s => meetsMinDifficulty(s.minDifficulty, difficulty));
    const rolesToFill = [];
    for (let i = 0; i < slotCount; i++) {
      rolesToFill.push(activeStructure[i % activeStructure.length]);
    }

    const usedNames = new Set();
    const usedMuscles = new Set();
    const results = [];

    rolesToFill.forEach(function (slotDef) {
      const picked = pickExerciseForSlot(slotDef, sessionCat, diffProfile, usedNames, usedMuscles, muscleFocus, equipFocus);
      if (picked) {
        usedNames.add(picked.name);
        (picked.m || []).forEach(m => usedMuscles.add(m));
      }
      results.push({ slotDef: slotDef, exercise: picked });
    });

    // Map results onto B.rows, following the template's existing slot
    // shape (slot/label/id) — only exerciseName, muscles, scheme change.
    B.rows = tDef.slots.map(function (s, idx) {
      const r = results[idx];
      const isFinisherSlot = r && r.slotDef.role === "finisher";
      const ex = r ? r.exercise : null;
      return {
        id: uid(),
        slot: s.slot,
        label: s.label,
        exerciseName: ex ? ex.name : "",
        scheme: ex ? pickScheme(diffProfile, isFinisherSlot) : s.scheme,
        target: "",
        muscles: ex ? (ex.m || []) : [],
      };
    });

    renderSlots();
    const filled = results.filter(r => r.exercise).length;
    if (filled < slotCount) {
      toast("Generated " + filled + "/" + slotCount + " — some slots had no match, fill manually");
    } else {
      toast("Workout generated ✓ — review & adjust as needed");
    }
  };

  // ── Muscle Focus dropdown options per session category ────────────
  // Legs / Chest / Back have real internal muscle splits worth focusing.
  // Full Body / Upper / Lower span too many groups for a single focus
  // to make sense, so they only offer "All".
  const FOCUS_OPTIONS_BY_CAT = {
    legs:  [["", "All — Balanced"], ["quad", "Quad Focus"], ["glute", "Glute Focus"], ["hamstring", "Hamstring Focus"]],
    lower: [["", "All — Balanced"], ["quad", "Quad Focus"], ["glute", "Glute Focus"], ["hamstring", "Hamstring Focus"]],
    chest: [["", "All — Balanced"], ["chestf", "Chest Focus"], ["shoulderf", "Shoulder Focus"], ["tricepf", "Tricep Focus"]],
    back:  [["", "All — Balanced"], ["backf", "Back (Lats) Focus"], ["bicepf", "Bicep Focus"]],
    full:  [["", "All — Balanced"]],
    upper: [["", "All — Balanced"]],
  };

  // Called from index.html's onchange handler on the Category select,
  // so the Muscle Focus dropdown always shows options relevant to the
  // chosen session type instead of irrelevant ones (e.g. "Bicep Focus"
  // showing up on a Legs day).
  window.updateFocusDropdown = function () {
    const catSelect = document.getElementById("b-cat");
    const focusSelect = document.getElementById("b-focus");
    if (!catSelect || !focusSelect) return;
    const cat = catSelect.value;
    const opts = FOCUS_OPTIONS_BY_CAT[cat] || [["", "All — Balanced"]];
    focusSelect.innerHTML = opts.map(function (o) {
      return '<option value="' + o[0] + '">' + o[1] + '</option>';
    }).join("");
  };

})();

export const CLEARANCE_RANK = Object.freeze({
  public: 0,
  internal: 1,
  confidential: 2,
  restricted: 3
});

const VALID_VISIBILITY = new Set(["org", "department", "groups", "users"]);

function rank(value) {
  return CLEARANCE_RANK[value] ?? -1;
}

function intersects(a = [], b = []) {
  const set = new Set(b);
  return a.some((item) => set.has(item));
}

function deny(reason, detail) {
  return { allowed: false, reason, detail };
}

function allow(reason, detail) {
  return { allowed: true, reason, detail };
}

/**
 * Deny-by-default authorization.
 *
 * Order matters:
 * 1. explicit deny beats every allow;
 * 2. clearance must meet the document classification;
 * 3. explicit user grant;
 * 4. group / department / org visibility, always with need-to-know project overlap.
 */
export function canAccess(user, doc) {
  if (!user) return deny("unauthenticated", "Tidak ada identitas pengguna.");
  if (!doc) return deny("not_found", "Dokumen tidak ditemukan.");

  const acl = doc.acl ?? {};
  if ((acl.deny_users ?? []).includes(user.id)) {
    return deny("explicit_deny", "Akses dicabut secara eksplisit untuk pengguna ini.");
  }
  if (intersects(acl.deny_groups ?? [], user.groups ?? [])) {
    return deny("explicit_deny", "Akses dicabut secara eksplisit untuk grup pengguna ini.");
  }

  const classification = doc.classification ?? "internal";
  if (rank(user.clearance) < rank(classification)) {
    return deny(
      "clearance",
      `Klasifikasi ${classification} melebihi clearance ${user.clearance ?? "tidak ada"}.`
    );
  }

  if ((acl.users ?? []).includes(user.id)) {
    return allow("explicit_user", "Pengguna memiliki grant eksplisit pada dokumen.");
  }

  const projects = acl.projects ?? [];
  const projectOk =
    projects.length === 0 || intersects(projects, user.projects ?? []);

  if (!projectOk) {
    return deny("need_to_know", "Pengguna tidak terlibat pada proyek terkait.");
  }

  const visibility = acl.visibility;
  if (!VALID_VISIBILITY.has(visibility)) {
    return deny("no_rule", "Tidak ada aturan akses yang cocok (deny-by-default).");
  }

  if (visibility === "org") {
    return allow("org", "Dokumen terbuka untuk seluruh organisasi pada clearance ini.");
  }

  if (visibility === "groups") {
    const groups = acl.groups ?? [];
    if (groups.length > 0 && intersects(groups, user.groups ?? [])) {
      return allow("group", "Pengguna berada pada grup yang diizinkan.");
    }
    return deny("group", "Pengguna tidak berada pada grup yang diizinkan.");
  }

  if (visibility === "department") {
    const departments = acl.departments ?? [];
    if (departments.includes(user.department)) {
      return allow("department", "Pengguna berada pada departemen yang diizinkan.");
    }
    return deny("department", "Pengguna tidak berada pada departemen yang diizinkan.");
  }

  if (visibility === "users") {
    return deny("user", "Pengguna tidak berada pada daftar pengguna yang diizinkan.");
  }

  return deny("no_rule", "Tidak ada aturan akses yang cocok (deny-by-default).");
}

/**
 * Field-level filtering. A field can require a group, explicit users, or a
 * minimum clearance. Hidden field values never enter the retrieval index or
 * the response.
 */
export function filterFields(user, doc) {
  const visible = [];
  let hidden = 0;

  for (const field of doc.fields ?? []) {
    let ok = true;

    if (field.users && field.users.length > 0) {
      ok = field.users.includes(user.id);
    } else if (field.groups && field.groups.length > 0) {
      ok = intersects(field.groups, user.groups ?? []);
    }

    if (ok && field.min_clearance) {
      ok = rank(user.clearance) >= rank(field.min_clearance);
    }

    if (ok) {
      visible.push({ label: field.label, value: field.value });
    } else {
      hidden += 1;
    }
  }

  return { fields: visible, hidden };
}

export function canAudit(user) {
  return Boolean(user && (user.groups ?? []).includes("audit"));
}

export function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    title: user.title,
    department: user.department,
    clearance: user.clearance,
    groups: user.groups ?? [],
    projects: user.projects ?? []
  };
}

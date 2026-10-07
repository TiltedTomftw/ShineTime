// employee-access: invite-code onboarding + sign-in for employees.
//
// Employees never see a dealership email/password. They join with an invite
// code + their name + a PIN; each gets their own auth account, which can only be
// created server-side (email confirmation is on), hence this function.
//
// Two modes, chosen on the app's sign-in screen:
//   - "join"   (first time): the code must be valid. A brand-new name is NOT
//              created straight away — the function answers { needsConfirm }
//              and the app asks "Join Ford Motors as Mike Smith?" first, so a
//              returning employee who types their name differently doesn't
//              silently become a second person with split job history.
//   - "signin" (returning): the code only identifies the dealership, so an
//              EXPIRED or used-up code still works for someone who is already a
//              member. Previously every sign-in re-checked the code and staff
//              were locked out a week after joining.
// Requests without a mode behave like "join" with confirmation skipped (older
// app builds).
//
// Manager-gated actions (caller must be owner/manager of the named dealership):
//   list_employees, reset_pin, set_active.
//
// Deploy:
//   npx supabase functions deploy employee-access --project-ref <ref>
//   npx supabase secrets set EMPLOYEE_PIN_PEPPER="<a long random string>"

import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

type AccessRequest = {
  action?: "enrol" | "list_employees" | "reset_pin" | "set_active";
  mode?: "join" | "signin";
  confirmNew?: boolean;
  code?: string;
  name?: string;
  pin?: string;
  // manager-gated actions
  dealershipId?: string;
  employeeUserId?: string;
  newPin?: string;
  active?: boolean;
};

// Mirrors public.slugify() from migration 004.
const slugify = (value: string) =>
  (value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

// Deterministic address so the same person resolves to the same account on any
// device. dealerships.slug is unique, so this is unique per dealership+name.
// The domain is intentionally unroutable — no mail is ever sent here.
const employeeEmail = (name: string, dealershipSlug: string) =>
  `${slugify(name)}@${dealershipSlug}.employees.shinetime.invalid`;

// The account password is derived from the PIN plus a server-side pepper, so a
// short PIN is never presented to the auth endpoint on its own and the client
// never learns the real credential.
async function derivePassword(pin: string, email: string, pepper: string) {
  const data = new TextEncoder().encode(`${pepper}:${email}:${pin}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return btoa(String.fromCharCode(...new Uint8Array(digest))).slice(0, 40);
}

// Confirm the caller is an owner/manager OF THIS dealership. Everything below
// runs with the service role, so this check is the only thing standing between a
// signed-in detailer (or another dealership's manager) and someone else's team.
async function requireManager(
  req: Request,
  admin: ReturnType<typeof createClient>,
  supabaseUrl: string,
  anonKey: string,
  dealershipId: string,
) {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token || !dealershipId) {
    return { error: json(401, { error: "Sign in as a manager first." }) };
  }

  const authed = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: userData } = await authed.auth.getUser();
  const caller = userData?.user;
  if (!caller) return { error: json(401, { error: "Sign in as a manager first." }) };

  const { data: membership } = await admin
    .from("dealership_memberships")
    .select("role")
    .eq("dealership_id", dealershipId)
    .eq("user_id", caller.id)
    .eq("is_active", true)
    .maybeSingle();

  if (!membership || !["owner", "manager"].includes(membership.role)) {
    return { error: json(403, { error: "Only a manager can do that." }) };
  }
  return { caller };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const pepper = Deno.env.get("EMPLOYEE_PIN_PEPPER") ?? "";
  if (!supabaseUrl || !serviceKey || !anonKey || !pepper) {
    return json(500, { error: "Function is not configured" });
  }

  let body: AccessRequest;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Invalid request" });
  }

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const action = body.action || "enrol";

  // --- Manager-gated: team list, PIN reset, deactivate/reactivate ----------
  // An employee's password is DERIVED from their PIN, so a forgotten PIN can
  // only be recovered here. Resetting keeps their existing user id, which keeps
  // their job history attached to them.
  if (action === "list_employees" || action === "reset_pin" || action === "set_active") {
    const dealershipId = (body.dealershipId || "").trim();
    const guard = await requireManager(req, admin, supabaseUrl, anonKey, dealershipId);
    if (guard.error) return guard.error;

    // All memberships (active and not), so a manager can reactivate someone.
    const { data: members } = await admin
      .from("dealership_memberships")
      .select("user_id, role, is_active, created_at")
      .eq("dealership_id", dealershipId);

    if (action === "list_employees") {
      const ids = (members || []).map((m) => m.user_id);
      const safeIds = ids.length ? ids : ["00000000-0000-0000-0000-000000000000"];
      const [{ data: profiles }, { data: lastJobs }] = await Promise.all([
        admin.from("profiles").select("user_id, full_name").in("user_id", safeIds),
        admin
          .from("jobs")
          .select("assigned_detailer_id, client_updated_at")
          .eq("dealership_id", dealershipId)
          .in("assigned_detailer_id", safeIds)
          .order("client_updated_at", { ascending: false })
          .limit(500),
      ]);

      const nameFor = new Map((profiles || []).map((p) => [p.user_id, p.full_name]));
      const lastActive = new Map<string, string>();
      for (const j of lastJobs || []) {
        if (j.assigned_detailer_id && !lastActive.has(j.assigned_detailer_id)) {
          lastActive.set(j.assigned_detailer_id, j.client_updated_at);
        }
      }
      return json(200, {
        employees: (members || []).map((m) => ({
          userId: m.user_id,
          role: m.role,
          isActive: m.is_active,
          name: nameFor.get(m.user_id) || "Unknown",
          joinedAt: m.created_at,
          lastActiveAt: lastActive.get(m.user_id) || null,
        })),
      });
    }

    const employeeUserId = (body.employeeUserId || "").trim();
    const target = (members || []).find((m) => m.user_id === employeeUserId);
    // The target must belong to the SAME dealership — otherwise a manager could
    // reach someone at another tenant.
    if (!employeeUserId || !target) {
      return json(403, { error: "That employee is not on your team." });
    }

    if (action === "set_active") {
      if (employeeUserId === guard.caller!.id) {
        return json(400, { error: "You can't deactivate yourself." });
      }
      if (target.role === "owner") {
        return json(400, { error: "The owner can't be deactivated here." });
      }
      const { error: updateError } = await admin
        .from("dealership_memberships")
        .update({ is_active: body.active !== false })
        .eq("dealership_id", dealershipId)
        .eq("user_id", employeeUserId);
      if (updateError) return json(500, { error: "Could not update that employee." });
      return json(200, { ok: true, employeeUserId, isActive: body.active !== false });
    }

    // reset_pin
    const newPin = (body.newPin || "").trim();
    if (!/^\d{4,6}$/.test(newPin)) {
      return json(400, { error: "Choose a new PIN of 4 to 6 digits." });
    }
    const { data: targetUser, error: targetError } = await admin.auth.admin.getUserById(employeeUserId);
    if (targetError || !targetUser?.user?.email) {
      return json(404, { error: "Could not find that employee." });
    }
    if (!targetUser.user.email.endsWith(".employees.shinetime.invalid")) {
      return json(400, { error: "Managers sign in with email and password; reset that from the login page." });
    }

    const newPassword = await derivePassword(newPin, targetUser.user.email, pepper);
    const { error: updateError } = await admin.auth.admin.updateUserById(employeeUserId, {
      password: newPassword,
    });
    if (updateError) {
      console.error("employee-access: reset_pin failed:", updateError.message);
      return json(500, { error: "Could not reset that PIN." });
    }
    return json(200, { ok: true, employeeUserId });
  }

  // --- Employee join / sign-in ----------------------------------------------
  const mode = body.mode === "signin" ? "signin" : body.mode === "join" ? "join" : "legacy";
  const code = (body.code || "").trim().toUpperCase();
  const name = (body.name || "").trim().replace(/\s+/g, " ").slice(0, 50);
  const pin = (body.pin || "").trim();

  if (!code || !name || !/^\d{4,6}$/.test(pin)) {
    return json(400, { error: "Enter your code, your name, and a PIN of 4 to 6 digits." });
  }

  // Any failure to identify the dealership returns ONE generic message so codes
  // and dealerships stay non-enumerable (as in migration 004).
  const invalid = () => json(400, { error: "That code isn't valid. Check it with your manager." });

  const { data: invite, error: inviteError } = await admin
    .from("dealership_invite_codes")
    .select("id, dealership_id, expires_at, max_uses, used_count, is_active")
    .eq("code", code)
    .maybeSingle();
  if (inviteError) return json(500, { error: "Could not check the code. Try again." });
  if (!invite) return invalid();

  const codeUsableForJoining =
    invite.is_active &&
    !(invite.expires_at && new Date(invite.expires_at).getTime() < Date.now()) &&
    !(invite.max_uses !== null && invite.used_count >= invite.max_uses);

  const { data: dealership } = await admin
    .from("dealerships")
    .select("id, name, slug")
    .eq("id", invite.dealership_id)
    .maybeSingle();
  if (!dealership) return invalid();

  const email = employeeEmail(name, dealership.slug);
  if (email.startsWith("@")) {
    return json(400, { error: "Please enter your name using letters or numbers." });
  }
  const password = await derivePassword(pin, email, pepper);
  const authClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });

  const sessionPayload = (session: { access_token: string; refresh_token: string }) => ({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    dealership: { id: dealership.id, name: dealership.name },
    name,
  });

  // 1) Existing account with the right PIN?
  const existing = await authClient.auth.signInWithPassword({ email, password });
  const existingSession = existing.data?.session;

  if (existingSession) {
    const { data: membership } = await admin
      .from("dealership_memberships")
      .select("is_active")
      .eq("dealership_id", dealership.id)
      .eq("user_id", existingSession.user.id)
      .maybeSingle();

    if (membership?.is_active) return json(200, sessionPayload(existingSession));
    if (membership && !membership.is_active) {
      return json(403, {
        error: `Your account at ${dealership.name} has been turned off. Ask your manager to turn it back on.`,
      });
    }
    // Account exists but isn't a member yet: joining needs a usable code.
    if (!codeUsableForJoining) return json(400, { error: "That code has expired. Ask your manager for a new one." });
    const asUser = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${existingSession.access_token}` } },
    });
    const { error: redeemError } = await asUser.rpc("redeem_invite_code", { p_code: code });
    if (redeemError) return invalid();
    return json(200, sessionPayload(existingSession));
  }

  // 2) No session: either a wrong PIN for an existing name, or a new person.
  if (mode === "signin") {
    return json(401, {
      error:
        `We couldn't find "${name}" at ${dealership.name} with that PIN. ` +
        "Use your name exactly as you entered it when you joined, or ask your manager to reset your PIN.",
    });
  }

  if (!codeUsableForJoining) {
    return json(400, { error: "That code has expired. Ask your manager for a new one." });
  }

  // Does this name already belong to someone here? Then the PIN was wrong —
  // say so now rather than asking them to confirm joining as a new person.
  // (createUser below stays the authoritative check.)
  const nameTaken = async () => {
    const { data: members } = await admin
      .from("dealership_memberships")
      .select("user_id")
      .eq("dealership_id", dealership.id);
    const ids = (members || []).map((m) => m.user_id);
    if (ids.length === 0) return false;
    const { data: profiles } = await admin.from("profiles").select("full_name").in("user_id", ids);
    return (profiles || []).some((p) => slugify(p.full_name || "") === slugify(name));
  };
  const takenMessage = () =>
    json(401, {
      error:
        `Someone named "${name}" already works at ${dealership.name}. ` +
        "If that's you, choose \"I've signed in before\" and check your PIN. Otherwise add your last initial.",
    });

  if (await nameTaken()) return takenMessage();

  if (mode === "join" && !body.confirmNew) {
    return json(200, {
      needsConfirm: true,
      dealership: { id: dealership.id, name: dealership.name },
      name,
    });
  }

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true, // no confirmation mail is deliverable for this domain
    user_metadata: { full_name: name, dealership_slug: dealership.slug },
  });

  if (createError) {
    // Only "already registered" means the sign-in above failed because the PIN
    // was wrong. Anything else is a real server problem and must NOT be reported
    // as a bad PIN.
    const detail = createError.message || "";
    const alreadyExists = createError.status === 422 || /already|registered|exists/i.test(detail);
    if (alreadyExists) return takenMessage();
    console.error("employee-access: createUser failed:", detail);
    return json(500, { error: "Could not create your account. Try again.", detail: detail.slice(0, 200) });
  }

  await admin
    .from("profiles")
    .upsert({ user_id: created.user.id, full_name: name }, { onConflict: "user_id" });

  const signedIn = await authClient.auth.signInWithPassword({ email, password });
  if (!signedIn.data?.session) return json(500, { error: "Could not start your session. Try again." });

  // Redeem as that user so the atomic FOR UPDATE / used_count / already-a-member
  // guards in migration 004 still apply.
  const asUser = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${signedIn.data.session.access_token}` } },
  });
  const { error: redeemError } = await asUser.rpc("redeem_invite_code", { p_code: code });
  if (redeemError) return invalid();

  return json(200, sessionPayload(signedIn.data.session));
});

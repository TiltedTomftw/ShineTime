// employee-access: invite-code onboarding + sign-in for employees.
//
// Employees must never see the dealership's email/password. They get an invite
// code from a manager and enroll with a code + their name + a PIN. Because
// redeem_invite_code() requires auth.uid(), each employee needs a real auth
// account — and because email confirmation is enabled on the project, that
// account can only be created server-side with the service-role key. Hence this
// function (privileged work never runs in the app).
//
// The SAME inputs handle first-time enrollment and later sign-ins, so a returning
// employee (or one on a new device) uses the identical screen.
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
  action?: "enrol" | "list_employees" | "reset_pin";
  code?: string;
  name?: string;
  pin?: string;
  // manager-gated actions
  dealershipId?: string;
  employeeUserId?: string;
  newPin?: string;
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

  // --- Manager-gated: see the team, and recover a forgotten PIN -----------
  // An employee's password is DERIVED from their PIN, so a forgotten PIN can
  // only be recovered here. Resetting keeps their existing user id, which is
  // what keeps their job history attached to them — deleting and re-enrolling
  // would mint a new id and split their history in two.
  if (action === "list_employees" || action === "reset_pin") {
    const dealershipId = (body.dealershipId || "").trim();
    const guard = await requireManager(req, admin, supabaseUrl, anonKey, dealershipId);
    if (guard.error) return guard.error;

    const { data: members } = await admin
      .from("dealership_memberships")
      .select("user_id, role")
      .eq("dealership_id", dealershipId)
      .eq("is_active", true);

    if (action === "list_employees") {
      const ids = (members || []).map((m) => m.user_id);
      const { data: profiles } = await admin
        .from("profiles")
        .select("user_id, full_name")
        .in("user_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);

      const nameFor = new Map((profiles || []).map((p) => [p.user_id, p.full_name]));
      return json(200, {
        employees: (members || []).map((m) => ({
          userId: m.user_id,
          role: m.role,
          name: nameFor.get(m.user_id) || "Unknown",
        })),
      });
    }

    // reset_pin
    const employeeUserId = (body.employeeUserId || "").trim();
    const newPin = (body.newPin || "").trim();
    if (!employeeUserId || newPin.length < 4) {
      return json(400, { error: "Choose an employee and a new PIN of at least 4 digits." });
    }

    // The target must belong to the SAME dealership — otherwise a manager could
    // reset the PIN of someone at another tenant.
    if (!(members || []).some((m) => m.user_id === employeeUserId)) {
      return json(403, { error: "That employee is not on your team." });
    }

    const { data: target, error: targetError } = await admin.auth.admin.getUserById(employeeUserId);
    if (targetError || !target?.user?.email) {
      return json(404, { error: "Could not find that employee." });
    }

    const newPassword = await derivePassword(newPin, target.user.email, pepper);
    const { error: updateError } = await admin.auth.admin.updateUserById(employeeUserId, {
      password: newPassword,
    });
    if (updateError) {
      console.error("employee-access: reset_pin failed:", updateError.message);
      return json(500, { error: "Could not reset that PIN." });
    }

    return json(200, { ok: true, employeeUserId });
  }

  const code = (body.code || "").trim().toUpperCase();
  const name = (body.name || "").trim().replace(/\s+/g, " ").slice(0, 50);
  const pin = (body.pin || "").trim();

  if (!code || !name || pin.length < 4) {
    return json(400, { error: "Enter your invite code, your name, and a PIN of at least 4 digits." });
  }

  // 1) Validate the code with the service role. Any failure returns ONE generic
  //    message so codes and dealerships stay non-enumerable (as in migration 004).
  const invalid = () => json(400, { error: "That invite code is not valid or has expired." });

  const { data: invite, error: inviteError } = await admin
    .from("dealership_invite_codes")
    .select("id, dealership_id, expires_at, max_uses, used_count, is_active")
    .eq("code", code)
    .maybeSingle();

  if (inviteError) return json(500, { error: "Could not verify the invite code." });
  if (!invite || !invite.is_active) return invalid();
  if (invite.expires_at && new Date(invite.expires_at).getTime() < Date.now()) return invalid();
  if (invite.max_uses !== null && invite.used_count >= invite.max_uses) return invalid();

  const { data: dealership } = await admin
    .from("dealerships")
    .select("id, name, slug")
    .eq("id", invite.dealership_id)
    .maybeSingle();
  if (!dealership) return invalid();

  // 2) Resolve this person's deterministic account.
  const email = employeeEmail(name, dealership.slug);
  if (email.startsWith("@")) {
    return json(400, { error: "Please enter your name using letters or numbers." });
  }
  const password = await derivePassword(pin, email, pepper);

  const authClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });

  // 3) Returning employee -> sign in. New employee -> create, then sign in.
  let session = null;
  const existing = await authClient.auth.signInWithPassword({ email, password });

  if (existing.data?.session) {
    session = existing.data.session;
  } else {
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // no confirmation mail is deliverable for this domain
      user_metadata: { full_name: name, dealership_slug: dealership.slug },
    });

    if (createError) {
      // Only an "already registered" failure means the sign-in above failed
      // because the PIN was wrong (the account exists). Anything else is a real
      // server-side problem and must NOT be reported as a bad PIN — conflating
      // the two hides genuine faults behind a plausible-looking user error.
      const detail = createError.message || "";
      const alreadyExists =
        createError.status === 422 || /already|registered|exists/i.test(detail);

      if (alreadyExists) {
        return json(401, {
          error: "That name is already used at this dealership, or the PIN is incorrect.",
        });
      }

      console.error("employee-access: createUser failed:", detail);
      return json(500, { error: "Could not create your account.", detail: detail.slice(0, 200) });
    }

    await admin
      .from("profiles")
      .upsert({ user_id: created.user.id, full_name: name }, { onConflict: "user_id" });

    const signedIn = await authClient.auth.signInWithPassword({ email, password });
    if (!signedIn.data?.session) return json(500, { error: "Could not start your session." });
    session = signedIn.data.session;
  }

  // 4) Redeem as that user, reusing the existing RPC so the atomic FOR UPDATE,
  //    used_count accounting and already-a-member guard all still apply.
  const asUser = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${session.access_token}` } },
  });
  const { error: redeemError } = await asUser.rpc("redeem_invite_code", { p_code: code });
  if (redeemError) return invalid();

  return json(200, {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    dealership: { id: dealership.id, name: dealership.name },
    name,
  });
});

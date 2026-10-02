import { createSupabaseContext } from 'npm:@supabase/server'
import { createClient } from 'npm:@supabase/supabase-js@2'

type CreateEmployeeInput = {
  action: 'create_employee'
  name: string
  workEmail?: string | null
  phone?: string | null
  loginId: string
  password: string
  workMode: 'office' | 'remote'
  designationId: string
  departmentId?: string | null
  managerId?: string | null
  joinDate: string
  shiftStart: string
  shiftEnd: string
  monthlySalary: number
}

type UpdateEmployeeInput = {
  action: 'update_employee'
  employeeId: string
  name: string
  workEmail?: string | null
  phone?: string | null
  workMode: 'office' | 'remote'
  designationId: string
  departmentId?: string | null
  managerId?: string | null
  joinDate: string
  shiftStart: string
  shiftEnd: string
  monthlySalary: number
}

type ResetPasswordInput = {
  action: 'reset_password'
  employeeId: string
}

type StatusInput = {
  action: 'set_status'
  employeeId: string
  status: 'active' | 'inactive'
}

type Input = CreateEmployeeInput | UpdateEmployeeInput | ResetPasswordInput | StatusInput

const corsHeaders = {
  'Access-Control-Allow-Origin': 'https://ira-eta-two.vercel.app',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function normalizeLoginId(value: string): string {
  return value.trim().toLowerCase()
}

function authEmail(loginId: string): string {
  return `${normalizeLoginId(loginId)}@employee.ira.local`
}

function validateLoginId(loginId: string) {
  return /^[a-z0-9][a-z0-9._-]{2,31}$/.test(normalizeLoginId(loginId))
}

function validatePassword(password: string) {
  return password.length >= 12
    && /[A-Z]/.test(password)
    && /[a-z]/.test(password)
    && /\d/.test(password)
    && /[^A-Za-z0-9]/.test(password)
}

async function isLeakedPassword(password: string): Promise<boolean> {
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(password));
  const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('').toUpperCase();
  const prefix = hash.slice(0, 5);
  const suffix = hash.slice(5);
  const response = await fetch('https://api.pwnedpasswords.com/range/' + prefix, {
    headers: {
      'User-Agent': 'IRA-Hospitality-Password-Protection/1.0',
      'Add-Padding': 'true',
    },
  });
  if (!response.ok) throw new Error('Password security verification is temporarily unavailable. Please try again.');
  const body = await response.text();
  return body.split(/\r?\n/).some(line => line.split(':', 1)[0].trim().toUpperCase() === suffix);
}

async function assertPasswordSafe(password: string) {
  if (!validatePassword(password)) {
    throw new Error('Password must be at least 12 characters and include uppercase, lowercase, number and symbol.');
  }
  if (await isLeakedPassword(password)) {
    throw new Error('Choose a different password. This password has appeared in known data breaches.');
  }
}

function generateTemporaryPassword() {
  return 'IRA@' + crypto.randomUUID().replace(/-/g, '').slice(0, 14) + '9a';
}

function cleanText(value?: string | null) {
  const v = value?.trim()
  return v ? v : null
}

async function ensureEmployeeLedgers(
  admin: ReturnType<typeof createClient>,
  employeeId: string,
  joinDate: string,
  asOfDate: string,
) {
  const { data: settings } = await admin
    .from('payroll_settings')
    .select('monthly_leave_accrual')
    .eq('id', true)
    .maybeSingle()

  const accrual = Number(settings?.monthly_leave_accrual ?? 1.5)
  const start = new Date(`${joinDate.slice(0, 7)}-01T00:00:00Z`)
  const end = new Date(`${asOfDate.slice(0, 7)}-01T00:00:00Z`)
  let opening = 0

  for (let cursor = new Date(start); cursor <= end; cursor.setUTCMonth(cursor.getUTCMonth() + 1)) {
    const periodStart = cursor.toISOString().slice(0, 10)
    const { data: existing } = await admin
      .from('leave_ledger')
      .select('closing_balance')
      .eq('employee_id', employeeId)
      .eq('period_start', periodStart)
      .maybeSingle()

    if (existing) {
      opening = Number(existing.closing_balance ?? opening)
      continue
    }

    const { error } = await admin.from('leave_ledger').insert({
      employee_id: employeeId,
      period_start: periodStart,
      opening_balance: opening,
      accrual,
      adjustment: 0,
      paid_used: 0,
      unpaid_used: 0,
      closing_balance: opening + accrual,
    })
    if (error && error.code !== '23505') throw error
    opening += accrual
  }
}

async function createEmployee(input: CreateEmployeeInput, admin: ReturnType<typeof createClient>, actorId: string) {
  const loginId = normalizeLoginId(input.loginId)
  if (!validateLoginId(loginId)) throw new Error('Login ID must be 3-32 characters using letters, numbers, dot, underscore or hyphen.')
  await assertPasswordSafe(input.password)
  if (!input.name.trim()) throw new Error('Employee name is required.')
  if (!input.designationId) throw new Error('Designation is required.')
  if (!input.joinDate) throw new Error('Join date is required.')
  if (!Number.isFinite(input.monthlySalary) || input.monthlySalary < 0) throw new Error('Monthly salary is invalid.')

  const { data: existing } = await admin
    .from('employees')
    .select('id')
    .ilike('login_id', loginId)
    .maybeSingle()

  if (existing) throw new Error('This Login ID is already in use.')

  const { data: designation } = await admin.from('designations').select('id').eq('id', input.designationId).maybeSingle()
  if (!designation) throw new Error('Selected designation was not found.')

  if (input.departmentId) {
    const { data: department } = await admin.from('departments').select('id').eq('id', input.departmentId).maybeSingle()
    if (!department) throw new Error('Selected department was not found.')
  }

  if (input.managerId) {
    const { data: manager } = await admin.from('employees').select('id,status').eq('id', input.managerId).maybeSingle()
    if (!manager || manager.status !== 'active') throw new Error('Selected manager is not active.')
  }

  const { data: authUser, error: authError } = await admin.auth.admin.createUser({
    email: authEmail(loginId),
    password: input.password,
    email_confirm: true,
    user_metadata: {
      name: input.name.trim(),
      login_id: loginId,
    },
  })

  if (authError || !authUser.user) throw new Error(authError?.message ?? 'Unable to create the employee login.')

  const userId = authUser.user.id

  try {
    const { data: seq, error: seqError } = await admin.rpc('next_employee_id')
    if (seqError || !seq) throw seqError ?? new Error('Unable to allocate employee ID.')
    const empId = String(seq)

    const { data: employee, error: employeeError } = await admin
      .from('employees')
      .insert({
        profile_id: userId,
        emp_id: empId,
        login_id: loginId,
        name: input.name.trim(),
        work_email: cleanText(input.workEmail),
        phone: cleanText(input.phone),
        status: 'active',
        work_mode: input.workMode,
        shift_start: input.shiftStart,
        shift_end: input.shiftEnd,
        join_date: input.joinDate,
        department_id: input.departmentId || null,
        designation_id: input.designationId,
        manager_id: input.managerId || null,
      })
      .select('id, emp_id, login_id')
      .single()

    if (employeeError || !employee) throw employeeError ?? new Error('Unable to create employee record.')

    const { error: profileError } = await admin
      .from('profiles')
      .update({ role: 'employee', emp_id: empId })
      .eq('id', userId)

    if (profileError) throw profileError

    const { error: salaryError } = await admin
      .from('salary_history')
      .insert({
        employee_id: employee.id,
        monthly_salary: input.monthlySalary,
        effective_from: input.joinDate,
      })

    if (salaryError) throw salaryError

    await ensureEmployeeLedgers(admin, employee.id, input.joinDate, new Date().toISOString().slice(0, 10))

    return { employeeId: employee.id, empId, loginId }
  } catch (error) {
    await admin.auth.admin.deleteUser(userId)
    throw error
  }
}

async function updateEmployee(input: UpdateEmployeeInput, admin: ReturnType<typeof createClient>, actorId: string) {
  const { data: current, error: currentError } = await admin
    .from('employees')
    .select('*')
    .eq('id', input.employeeId)
    .maybeSingle()
  if (input.managerId === input.employeeId) throw new Error('An employee cannot be their own manager.')
  if (currentError || !current) throw new Error('Employee not found.')

  if (!input.name.trim()) throw new Error('Employee name is required.')
  if (!input.designationId) throw new Error('Designation is required.')
  if (!Number.isFinite(input.monthlySalary) || input.monthlySalary < 0) throw new Error('Monthly salary is invalid.')

  const { error: employeeError } = await admin
    .from('employees')
    .update({
      name: input.name.trim(),
      work_email: cleanText(input.workEmail),
      phone: cleanText(input.phone),
      work_mode: input.workMode,
      designation_id: input.designationId,
      department_id: input.departmentId || null,
      manager_id: input.managerId || null,
      join_date: input.joinDate,
      shift_start: input.shiftStart,
      shift_end: input.shiftEnd,
    })
    .eq('id', input.employeeId)

  if (employeeError) throw employeeError

  const { data: latestSalary } = await admin
    .from('salary_history')
    .select('monthly_salary,effective_from')
    .eq('employee_id', input.employeeId)
    .order('effective_from', { ascending: false })
    .limit(1)
    .maybeSingle()

  const newSalary = Number(input.monthlySalary)
  if (!latestSalary || Number(latestSalary.monthly_salary) !== newSalary) {
    const effective = new Date().toISOString().slice(0, 10)

    if (latestSalary?.effective_from === effective) {
      const { error: salaryError } = await admin
        .from('salary_history')
        .update({ monthly_salary: newSalary })
        .eq('employee_id', input.employeeId)
        .eq('effective_from', effective)
      if (salaryError) throw salaryError
    } else {
      const previousEffectiveTo = new Date(Date.parse(effective + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10)
      const { error: closeError } = await admin
        .from('salary_history')
        .update({ effective_to: previousEffectiveTo })
        .eq('employee_id', input.employeeId)
        .is('effective_to', null)
      if (closeError) throw closeError

      const { error: salaryError } = await admin
        .from('salary_history')
        .insert({
          employee_id: input.employeeId,
          monthly_salary: newSalary,
          effective_from: effective,
        })
      if (salaryError) throw salaryError
    }
  }

  await ensureEmployeeLedgers(admin, input.employeeId, current.join_date, new Date().toISOString().slice(0, 10))
  return { employeeId: input.employeeId }
}

async function resetPassword(input: ResetPasswordInput, admin: ReturnType<typeof createClient>) {
  const { data: employee, error } = await admin
    .from('employees')
    .select('profile_id,name,login_id,status')
    .eq('id', input.employeeId)
    .maybeSingle()
  if (error || !employee) throw new Error('Employee not found.')

  let temporaryPassword = generateTemporaryPassword();
  for (let attempt = 0; attempt < 3 && await isLeakedPassword(temporaryPassword); attempt += 1) {
    temporaryPassword = generateTemporaryPassword();
  }
  await assertPasswordSafe(temporaryPassword);
  const { error: authError } = await admin.auth.admin.updateUserById(employee.profile_id, {
    password: temporaryPassword,
  })
  if (authError) throw new Error(authError.message)

  return { loginId: employee.login_id, temporaryPassword }
}

async function setStatus(input: StatusInput, admin: ReturnType<typeof createClient>) {
  const { data: employee, error: employeeError } = await admin
    .from('employees')
    .select('id,profile_id,status')
    .eq('id', input.employeeId)
    .maybeSingle()
  if (employeeError || !employee) throw new Error(employeeError?.message ?? 'Employee not found.')
  if (employee.status === input.status) return { employeeId: input.employeeId, status: input.status }

  const { error } = await admin
    .from('employees')
    .update({ status: input.status })
    .eq('id', input.employeeId)
  if (error) throw error

  const banDuration = input.status === 'inactive' ? '876000h' : 'none'
  const { error: authError } = await admin.auth.admin.updateUserById(employee.profile_id, { ban_duration: banDuration })
  if (authError) {
    await admin.from('employees').update({ status: employee.status }).eq('id', input.employeeId)
    throw new Error(authError.message)
  }

  if (input.status === 'inactive') {
    const { data: activeSessions } = await admin
      .from('auth_sessions')
      .select('id,login_at')
      .eq('user_id', employee.profile_id)
      .eq('status', 'active')
    for (const row of activeSessions ?? []) {
      const duration = Math.max(0, Math.floor((Date.now() - new Date(row.login_at).getTime()) / 1000))
      await admin.from('auth_sessions').update({
        logout_at: new Date().toISOString(),
        session_duration_seconds: duration,
        status: 'ended',
      }).eq('id', row.id)
    }
  }
  return { employeeId: input.employeeId, status: input.status }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const { data: ctx, error: authError } = await createSupabaseContext(req, { auth: 'user' })
  if (authError || !ctx?.userClaims?.id) {
    return json({ error: 'Authentication required' }, authError?.status ?? 401)
  }

  try {
    const admin = ctx.supabaseAdmin
    const actorId = ctx.userClaims.id

    const { data: profile, error: profileError } = await admin
      .from('profiles')
      .select('role')
      .eq('id', actorId)
      .maybeSingle()

    if (profileError || profile?.role !== 'admin') {
      return json({ error: 'Admin access required' }, 403)
    }

    const input = await req.json() as Input

    switch (input.action) {
      case 'create_employee':
        return json(await createEmployee(input, admin, actorId), 201)
      case 'update_employee':
        return json(await updateEmployee(input, admin, actorId))
      case 'reset_password':
        return json(await resetPassword(input, admin))
      case 'set_status':
        return json(await setStatus(input, admin))
      default:
        return json({ error: 'Unsupported action' }, 400)
    }
  } catch (error) {
    console.error('[employee-admin]', error)
    return json({ error: error instanceof Error ? error.message : 'Request failed' }, 400)
  }
})

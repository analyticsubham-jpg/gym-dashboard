'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import AuthGuard from '@/components/AuthGuard'
import { supabase } from '@/lib/supabase'

const GYM_NAME = process.env.NEXT_PUBLIC_GYM_NAME || 'FitZone Gym'
const TABS = ['Members', 'Payments', 'Equipment', 'Archived Members']
const EQUIPMENT_STATUSES = ['Operational', 'Under Maintenance', 'Broken']

const MEMBERSHIP_PLANS = {
  daily: { name: 'Daily', price: 150, months: 0, days: 1 },
  monthly: { name: 'Monthly', price: 1500, months: 1, days: 0 },
  '3months': { name: '3 Months', price: 4000, months: 3, days: 0 },
  '6months': { name: '6 Months', price: 5500, months: 6, days: 0 },
  yearly: { name: 'Yearly', price: 9000, months: 12, days: 0 }
}

function formatDate(dateStr) {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function calculateNextDueDate(joiningDateStr, planKey) {
  const date = new Date(joiningDateStr)
  const plan = MEMBERSHIP_PLANS[planKey]
  if (!plan) return joiningDateStr

  if (plan.months > 0) {
    date.setMonth(date.getMonth() + plan.months)
  } else if (plan.days > 0) {
    date.setDate(date.getDate() + plan.days)
  }
  return date.toISOString().split('T')[0]
}

function calculateMaintenanceDate(baseDateStr, monthsToAdd) {
  if (!baseDateStr) return '—'
  const date = new Date(baseDateStr)
  date.setMonth(date.getMonth() + monthsToAdd)
  return date.toISOString().split('T')[0]
}

function formatPhoneForWhatsApp(phone) {
  return phone.replace(/\D/g, '')
}

function getPaymentUrgency(dueDate) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  
  const due = new Date(dueDate)
  due.setHours(0, 0, 0, 0)
  
  const thirtyDaysFromNow = new Date()
  thirtyDaysFromNow.setDate(today.getDate() + 30)
  thirtyDaysFromNow.setHours(0, 0, 0, 0)

  if (due < today) return 'Overdue'
  if (due >= today && due <= thirtyDaysFromNow) return 'Upcoming'
  return 'Future'
}

async function loadDashboardData() {
  const [membersRes, paymentsRes, equipmentRes] = await Promise.all([
    supabase.from('members').select('*').order('name'),
    supabase.from('payments').select('*, members(*)').order('due_date', { ascending: false }).order('id', { ascending: false }),
    supabase.from('equipment').select('*').order('name'),
  ])

  if (membersRes.error || paymentsRes.error || equipmentRes.error) {
    return { error: membersRes.error?.message || paymentsRes.error?.message || equipmentRes.error?.message }
  }

  const payments = paymentsRes.data || []
  const overdueMemberIds = new Set()
  
  for (const payment of payments) {
    if (payment.status === 'Pending' && getPaymentUrgency(payment.due_date) === 'Overdue') {
      overdueMemberIds.add(payment.member_id)
    }
  }

  return {
    members: membersRes.data || [],
    payments,
    equipment: equipmentRes.data || [],
    overdueMemberIds,
  }
}

function GymDashboard() {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState('Members')
  const [loading, setLoading] = useState(true)
  const [members, setMembers] = useState([])
  const [payments, setPayments] = useState([])
  const [equipment, setEquipment] = useState([])
  const [overdueMemberIds, setOverdueMemberIds] = useState(new Set())
  
  const [showAddMemberModal, setShowAddMemberModal] = useState(false)
  const [showAddEquipmentModal, setShowAddEquipmentModal] = useState(false)
  
  const [newMember, setNewMember] = useState({
    name: '', phone: '', dob: '', gender: 'Male', 
    address: '', class_timing: 'Morning (6 AM - 9 AM)', 
    trainer_name: 'None', membership_type: 'monthly',
    joining_date: new Date().toISOString().split('T')[0]
  })

  const [newEquipment, setNewEquipment] = useState({
    name: '',
    added_date: new Date().toISOString().split('T')[0],
    supervisor: ''
  })
  
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const fetchData = useCallback(async () => {
    const result = await loadDashboardData()
    if (result.error) {
      setError(result.error)
    } else {
      setMembers(result.members)
      setPayments(result.payments)
      setEquipment(result.equipment)
      setOverdueMemberIds(result.overdueMemberIds)
    }
  }, [])

  useEffect(() => {
    const initializeData = async () => {
      setLoading(true)
      await fetchData()
      setLoading(false)
    }
    initializeData()
  }, [fetchData])

  const activeMembersList = members.filter(m => !m.archived)
  const archivedMembersList = members.filter(m => m.archived)
  
  const activeMembersCount = activeMembersList.length
  
  const pendingPaymentsCount = payments.filter(
    (p) => p.status === 'Pending' && getPaymentUrgency(p.due_date) === 'Overdue'
  ).length
  
  const brokenEquipmentCount = equipment.filter((e) => e.status === 'Broken').length

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.replace('/login')
  }

  const handleAddMember = async (e) => {
    e.preventDefault()
    setSubmitting(true)
    setError('')

    const { data: memberData, error: insertMemberError } = await supabase
      .from('members')
      .insert({
        name: newMember.name.trim(),
        phone: newMember.phone.trim(),
        dob: newMember.dob || null,
        gender: newMember.gender,
        address: newMember.address.trim(),
        class_timing: newMember.class_timing,
        trainer_name: newMember.trainer_name.trim(),
        membership_type: newMember.membership_type,
        joining_date: newMember.joining_date,
        archived: false,
        archived_date: null
      })
      .select()

    if (insertMemberError) {
      setError(insertMemberError.message)
      setSubmitting(false)
      return
    }

    const createdMember = memberData[0]
    const chosenPlan = MEMBERSHIP_PLANS[newMember.membership_type]
    const computedDueDate = calculateNextDueDate(newMember.joining_date, newMember.membership_type)

    const { error: insertPaymentError } = await supabase
      .from('payments')
      .insert({
        member_id: createdMember.id,
        amount: chosenPlan.price,
        due_date: computedDueDate,
        status: 'Pending'
      })

    if (insertPaymentError) {
      setError(insertPaymentError.message)
      setSubmitting(false)
      return
    }

    setNewMember({
      name: '', phone: '', dob: '', gender: 'Male', 
      address: '', class_timing: 'Morning (6 AM - 9 AM)', 
      trainer_name: 'None', membership_type: 'monthly',
      joining_date: new Date().toISOString().split('T')[0]
    })
    setShowAddMemberModal(false)
    setSubmitting(false)
    await fetchData()
  }

  const handleToggleArchiveMember = async (memberId, targetArchiveState) => {
    setError('')
    let chosenArchiveDate = null;

    if (targetArchiveState === true) {
      const todayStr = new Date().toISOString().split('T')[0];
      const userInputDate = window.prompt(
        "Enter the exact future effective date for this archival (YYYY-MM-DD):", 
        todayStr
      );
      
      if (userInputDate === null) return; // Cancelled by user
      
      if (!/^\d{4}-\d{2}-\d{2}$/.test(userInputDate) || isNaN(Date.parse(userInputDate))) {
        setError('Invalid archival date format provided. Please try again using YYYY-MM-DD.');
        return;
      }
      chosenArchiveDate = userInputDate;
    }

    const { error: archiveError } = await supabase
      .from('members')
      .update({ 
        archived: targetArchiveState,
        archived_date: chosenArchiveDate
      })
      .eq('id', memberId)

    if (archiveError) {
      setError(archiveError.message)
      return
    }
    await fetchData()
  }

  const handleAddEquipment = async (e) => {
    e.preventDefault()
    if (!newEquipment.name.trim()) return
    setSubmitting(true)
    setError('')

    const { error: insertError } = await supabase
      .from('equipment')
      .insert({
        name: newEquipment.name.trim(),
        added_date: newEquipment.added_date,
        supervisor: newEquipment.supervisor.trim() || 'Admin',
        status: 'Operational',
        routine_check_done: false,
        overhaul_check_done: false
      })

    if (insertError) {
      setError(insertError.message)
      setSubmitting(false)
      return
    }

    setNewEquipment({
      name: '',
      added_date: new Date().toISOString().split('T')[0],
      supervisor: ''
    })
    setShowAddEquipmentModal(false)
    setSubmitting(false)
    await fetchData()
  }

  const handleRemind = (member) => {
    const message = `Hi ${member.name}, this is a friendly reminder that your ${MEMBERSHIP_PLANS[member.membership_type]?.name || ''} gym fee renewal is due. Please clear it at your earliest convenience. Thanks, ${GYM_NAME}!`
    const phone = formatPhoneForWhatsApp(member.phone)
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, '_blank')
  }

  const handleMarkPaid = async (paymentId) => {
    setError('')
    
    const { data: currentPayment, error: fetchError } = await supabase
      .from('payments')
      .select('*, members(*)')
      .eq('id', paymentId)
      .single();

    if (fetchError || !currentPayment) {
      setError(fetchError?.message || 'Payment record not found');
      return;
    }

    const { error: updateError } = await supabase
      .from('payments')
      .update({ status: 'Paid' })
      .eq('id', paymentId);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    const memberInfo = currentPayment.members;
    if (memberInfo) {
      const nextComputedDueDate = calculateNextDueDate(currentPayment.due_date, memberInfo.membership_type);
      
      // Stop automatic generation if next invoice falls on or after their set future archival target date
      if (memberInfo.archived_date && nextComputedDueDate >= memberInfo.archived_date) {
        await fetchData();
        return;
      }

      const chosenPlan = MEMBERSHIP_PLANS[memberInfo.membership_type];

      const { error: insertNextError } = await supabase
        .from('payments')
        .insert({
          member_id: memberInfo.id,
          amount: chosenPlan.price,
          due_date: nextComputedDueDate,
          status: 'Pending'
        });

      if (insertNextError) {
        setError(insertNextError.message);
        return;
      }
    }
    
    await fetchData();
  }

  const handleEquipmentStatusChange = async (equipmentId, status) => {
    const { error: updateError } = await supabase
      .from('equipment')
      .update({ status })
      .eq('id', equipmentId)

    if (updateError) {
      setError(updateError.message)
      return
    }

    setEquipment((prev) =>
      prev.map((item) => (item.id === equipmentId ? { ...item, status } : item))
    )
  }

  const handleMaintenanceCheckboxChange = async (equipmentId, field, value) => {
    const dateField = field === 'routine_check_done' ? 'last_routine_date' : 'last_overhaul_date';
    const targetDate = value ? new Date().toISOString().split('T')[0] : null;

    const { error: updateError } = await supabase
      .from('equipment')
      .update({ 
        [field]: value,
        [dateField]: targetDate
      })
      .eq('id', equipmentId)

    if (updateError) {
      setError(updateError.message)
      return
    }

    await fetchData()
  }

  const generateInvoicePDF = (payment) => {
    const memberInfo = payment.members || {}
    const printWindow = window.open('', '_blank')
    
    printWindow.document.write(`
      <html>
        <head>
          <title>Invoice - ${payment.id}</title>
          <style>
            body { font-family: 'Segoe UI', Arial, sans-serif; padding: 40px; color: #333; line-height: 1.5; }
            .header { text-align: center; border-bottom: 2px solid #333; padding-bottom: 20px; margin-bottom: 30px; }
            .title { font-size: 28px; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; }
            .invoice-details { display: flex; justify-content: space-between; margin-bottom: 40px; font-size: 14px; }
            .bill-table { width: 100%; border-collapse: collapse; margin-bottom: 50px; }
            .bill-table th { background: #f4f4f4; border: 1px solid #ddd; padding: 12px; text-align: left; }
            .bill-table td { border: 1px solid #ddd; padding: 12px; }
            .status-stamp { display: inline-block; border: 3px solid #047857; color: #047857; font-weight: bold; text-transform: uppercase; padding: 8px 15px; font-size: 18px; border-radius: 4px; transform: rotate(-5deg); margin-bottom: 30px; }
            .footer-sign { margin-top: 80px; display: flex; justify-content: flex-end; }
            .signature-box { text-align: center; width: 220px; }
            .line { border-top: 1px solid #000; margin-bottom: 5px; }
          </style>
        </head>
        <body>
          <div class="header">
            <div class="title">${GYM_NAME}</div>
            <p style="margin: 5px 0 0 0; color: #666;">Premium Fitness Center Portal</p>
          </div>
          
          <div class="invoice-details">
            <div>
              <strong>Billed To:</strong><br>
              Name: ${memberInfo.name || 'N/A'}<br>
              Phone: ${memberInfo.phone || 'N/A'}<br>
              Gender: ${memberInfo.gender || 'N/A'}<br>
              Timing: ${memberInfo.class_timing || 'N/A'}
            </div>
            <div style="text-align: right;">
              <strong>Invoice Details:</strong><br>
              Date: ${new Date().toLocaleDateString('en-IN')}<br>
              Plan: ${MEMBERSHIP_PLANS[memberInfo.membership_type]?.name || 'Custom'}<br>
              Next Renewal: ${formatDate(payment.due_date)}
            </div>
          </div>

          <div style="text-align: center;">
            <div class="status-stamp">BILL PAID</div>
          </div>

          <table class="bill-table">
            <thead>
              <tr>
                <th>Description</th>
                <th style="text-align: right;">Amount Paid</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Gym Membership Enrollment Fee (${MEMBERSHIP_PLANS[memberInfo.membership_type]?.name || 'Standard Plan'})<br>
                <small style="color: #666;">Personal Trainer Assigned: ${memberInfo.trainer_name || 'None'}</small></td>
                <td style="text-align: right; font-weight: bold;">₹${Number(payment.amount).toLocaleString('en-IN')}</td>
              </tr>
            </tbody>
          </table>

          <div class="footer-sign">
            <div class="signature-box">
              <div class="line"></div>
              <span style="font-size: 13px; color: #555;">Accountant Signature</span>
            </div>
          </div>
          
          <script>
            window.onload = function() { window.print(); }
          </script>
        </body>
      </html>
    `)
    printWindow.document.close()
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/80 backdrop-blur-md dark:border-slate-700 dark:bg-slate-800/80">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6">
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100 sm:text-2xl">{GYM_NAME}</h1>
          <button onClick={handleLogout} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-500">
            Logout
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
        {error && (
          <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-300">
            {error}
          </div>
        )}

        <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <OverviewCard title="Active Members" value={activeMembersCount} icon="👥" color="blue" />
          <OverviewCard title="Overdue Payments" value={pendingPaymentsCount} icon="💳" color="amber" />
          <OverviewCard title="Broken Equipment" value={brokenEquipmentCount} icon="🔧" color="red" />
        </div>

        <nav className="mb-6 flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-800">
          {TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 whitespace-nowrap rounded-lg px-4 py-2.5 text-sm font-medium transition ${
                activeTab === tab ? 'bg-slate-800 text-white dark:bg-slate-600' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700'
              }`}
            >
              {tab}
            </button>
          ))}
        </nav>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-300 border-t-slate-600 dark:border-slate-600 dark:border-t-slate-300" />
          </div>
        ) : (
          <>
            {/* Active Members View */}
            {activeTab === 'Members' && (
              <section>
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Active Members Registry</h2>
                  <button onClick={() => setShowAddMemberModal(true)} className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 dark:bg-slate-600 dark:hover:bg-slate-500">
                    + Register New Member
                  </button>
                </div>

                <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/50">
                        <tr>
                          <th className="px-4 py-3 font-medium text-slate-600 dark:text-slate-300">Name</th>
                          <th className="px-4 py-3 font-medium text-slate-600 dark:text-slate-300">Phone & Plan</th>
                          <th className="px-4 py-3 font-medium text-slate-600 dark:text-slate-300">Class & Trainer</th>
                          <th className="px-4 py-3 font-medium text-slate-600 dark:text-slate-300">Billing</th>
                          <th className="px-4 py-3 font-medium text-slate-600 dark:text-slate-300">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                        {activeMembersList.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="px-4 py-8 text-center text-slate-500">No active members found.</td>
                          </tr>
                        ) : (
                          activeMembersList.map((member) => {
                            const isOverdue = overdueMemberIds.has(member.id)
                            return (
                              <tr key={member.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/50">
                                <td className="px-4 py-3">
                                  <div className="font-medium text-slate-900 dark:text-slate-100">{member.name}</div>
                                  <div className="text-xs text-slate-400">DOB: {formatDate(member.dob)} | {member.gender}</div>
                                </td>
                                <td className="px-4 py-3 text-slate-600 dark:text-slate-400">
                                  <div>{member.phone}</div>
                                  <span className="inline-block text-xs font-semibold uppercase text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded dark:bg-slate-700 dark:text-slate-300">
                                    {MEMBERSHIP_PLANS[member.membership_type]?.name}
                                  </span>
                                </td>
                                <td className="px-4 py-3 text-slate-600 dark:text-slate-400">
                                  <div className="text-xs font-medium">{member.class_timing}</div>
                                  <div className="text-xs text-slate-400">PT: {member.trainer_name}</div>
                                </td>
                                <td className="px-4 py-3">
                                  <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${isOverdue ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'}`}>
                                    {isOverdue ? 'Overdue' : 'Clear'}
                                  </span>
                                </td>
                                <td className="px-4 py-3 space-x-2">
                                  <button onClick={() => handleRemind(member)} disabled={!isOverdue} className="rounded-lg bg-green-600 px-2.5 py-1.5 text-xs font-medium text-white transition hover:bg-green-500 disabled:cursor-not-allowed disabled:opacity-30">
                                    Nudge
                                  </button>
                                  <button onClick={() => handleToggleArchiveMember(member.id, true)} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700">
                                    Archive
                                  </button>
                                </td>
                              </tr>
                            )
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </section>
            )}

            {/* Archived Members View */}
            {activeTab === 'Archived Members' && (
              <section>
                <h2 className="mb-4 text-lg font-semibold text-slate-900 dark:text-slate-100">Archived Members Pool</h2>
                <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/50">
                        <tr>
                          <th className="px-4 py-3 font-medium text-slate-600 dark:text-slate-300">Name</th>
                          <th className="px-4 py-3 font-medium text-slate-600 dark:text-slate-300">Phone</th>
                          <th className="px-4 py-3 font-medium text-slate-600 dark:text-slate-300">Plan Style</th>
                          <th className="px-4 py-3 font-medium text-slate-600 dark:text-slate-300">Archived Date</th>
                          <th className="px-4 py-3 font-medium text-slate-600 dark:text-slate-300">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                        {archivedMembersList.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="px-4 py-8 text-center text-slate-500">No archived history records found.</td>
                          </tr>
                        ) : (
                          archivedMembersList.map((member) => (
                            <tr key={member.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/50">
                              <td className="px-4 py-3 font-medium text-slate-900 dark:text-slate-100">{member.name}</td>
                              <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{member.phone}</td>
                              <td className="px-4 py-3 text-slate-600 dark:text-slate-400 uppercase font-semibold text-xs">
                                {MEMBERSHIP_PLANS[member.membership_type]?.name}
                              </td>
                              <td className="px-4 py-3 text-slate-500 text-xs">
                                {formatDate(member.archived_date)}
                              </td>
                              <td className="px-4 py-3">
                                <button onClick={() => handleToggleArchiveMember(member.id, false)} className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium text-white dark:bg-slate-600 dark:hover:bg-slate-500">
                                  Restore Profile
                                </button>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </section>
            )}

            {/* Payments View Layout */}
            {activeTab === 'Payments' && (
              <section>
                <h2 className="mb-4 text-lg font-semibold text-slate-900 dark:text-slate-100">Billing Ledgers</h2>
                <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/50">
                        <tr>
                          <th className="px-4 py-3 font-medium text-slate-600 dark:text-slate-300">Member</th>
                          <th className="px-4 py-3 font-medium text-slate-600 dark:text-slate-300">Cost</th>
                          <th className="px-4 py-3 font-medium text-slate-600 dark:text-slate-300">Due Date</th>
                          <th className="px-4 py-3 font-medium text-slate-600 dark:text-slate-300">Urgency Stage</th>
                          <th className="px-4 py-3 font-medium text-slate-600 dark:text-slate-300">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                        {payments.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="px-4 py-8 text-center text-slate-500">No payment ledgers recorded.</td>
                          </tr>
                        ) : (
                          payments.map((payment) => {
                            const urgency = getPaymentUrgency(payment.due_date)
                            
                            const badgeStyle = payment.status === 'Paid'
                              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                              : urgency === 'Overdue'
                              ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 font-bold'
                              : urgency === 'Upcoming'
                              ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                              : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-400'

                            return (
                              <tr key={payment.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/50">
                                <td className="px-4 py-3 font-medium text-slate-900 dark:text-slate-100">
                                  {payment.members?.name || 'Unknown'} {payment.members?.archived && <span className="text-[10px] text-slate-400">(Archived)</span>}
                                </td>
                                <td className="px-4 py-3 text-slate-600 dark:text-slate-400 font-semibold">
                                  ₹{Number(payment.amount).toLocaleString('en-IN')}
                                </td>
                                <td className="px-4 py-3 text-slate-600 dark:text-slate-400">
                                  {formatDate(payment.due_date)}
                                </td>
                                <td className="px-4 py-3">
                                  <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${badgeStyle}`}>
                                    {payment.status === 'Paid' ? 'Paid' : urgency}
                                  </span>
                                </td>
                                <td className="px-4 py-3 space-x-2">
                                  {payment.status === 'Pending' ? (
                                    <button onClick={() => handleMarkPaid(payment.id)} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-emerald-500">
                                      Mark Paid
                                    </button>
                                  ) : (
                                    <button onClick={() => generateInvoicePDF(payment)} className="rounded-lg bg-slate-700 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-slate-600">
                                      🖨️ PDF Invoice
                                    </button>
                                  )}
                                </td>
                              </tr>
                            )
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </section>
            )}

            {/* Equipment Tab Layout */}
            {activeTab === 'Equipment' && (
              <section>
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Infrastructure Inventory</h2>
                  <button onClick={() => setShowAddEquipmentModal(true)} className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 dark:bg-slate-600 dark:hover:bg-slate-500">
                    + Add New Equipment
                  </button>
                </div>

                {equipment.length === 0 ? (
                  <div className="rounded-xl border border-slate-200 bg-white px-4 py-12 text-center text-slate-500 dark:border-slate-700 dark:bg-slate-800">
                    No equipment cataloged yet.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
                    {equipment.map((item) => (
                      <div key={item.id} className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-800 flex flex-col justify-between shadow-sm">
                        <div>
                          <div className="mb-2 flex items-start justify-between gap-2">
                            <h3 className="font-bold text-slate-900 dark:text-slate-100 text-base">{item.name}</h3>
                            <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${item.status === 'Operational' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300' : item.status === 'Under Maintenance' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300' : 'bg-red-100 text-red-700 dark:bg-red-900/20 dark:text-red-300'}`}>
                              {item.status}
                            </span>
                          </div>
                          
                          <div className="space-y-1 my-3 text-xs text-slate-500 dark:text-slate-400 border-t border-b border-slate-100 dark:border-slate-700/50 py-2">
                            <div>📅 <span className="font-medium">Added:</span> {formatDate(item.added_date)}</div>
                            <div>👤 <span className="font-medium">Supervisor:</span> {item.supervisor || 'Admin'}</div>
                            
                            <div className="text-emerald-600 dark:text-emerald-400">
                              ✨ <span className="font-medium text-slate-500 dark:text-slate-400">Next Routine Inspection (Monthly):</span>{' '}
                              {formatDate(calculateMaintenanceDate(item.last_routine_date || item.added_date, 1))}
                            </div>
                            <div className="text-blue-600 dark:text-blue-400">
                              🛡️ <span className="font-medium text-slate-500 dark:text-slate-400">Next Major Overhaul (4-Month):</span>{' '}
                              {formatDate(calculateMaintenanceDate(item.last_overhaul_date || item.added_date, 4))}
                            </div>
                          </div>

                          <div className="my-3 space-y-2 rounded-lg bg-slate-50 p-2.5 dark:bg-slate-700/30">
                            <div className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                id={`routine-${item.id}`}
                                checked={item.routine_check_done || false}
                                onChange={(e) => handleMaintenanceCheckboxChange(item.id, 'routine_check_done', e.target.checked)}
                                className="h-4 w-4 rounded border-slate-300 text-slate-800 outline-none focus:ring-0 accent-slate-800"
                              />
                              <label htmlFor={`routine-${item.id}`} className="text-xs font-medium text-slate-700 dark:text-slate-300 select-none">
                                Routine Inspection Done
                              </label>
                            </div>
                            <div className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                id={`overhaul-${item.id}`}
                                checked={item.overhaul_check_done || false}
                                onChange={(e) => handleMaintenanceCheckboxChange(item.id, 'overhaul_check_done', e.target.checked)}
                                className="h-4 w-4 rounded border-slate-300 text-slate-800 outline-none focus:ring-0 accent-slate-800"
                              />
                              <label htmlFor={`overhaul-${item.id}`} className="text-xs font-medium text-slate-700 dark:text-slate-300 select-none">
                                Major Overhaul Done
                              </label>
                            </div>
                          </div>
                        </div>
                        
                        <div className="mt-2">
                          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-400">Change Condition</label>
                          <select
                            value={item.status}
                            onChange={(e) => handleEquipmentStatusChange(item.id, e.target.value)}
                            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
                          >
                            {EQUIPMENT_STATUSES.map((s) => (
                              <option key={s} value={s}>{s}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}
          </>
        )}
      </main>

      {/* Add Member Modal */}
      {showAddMemberModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => !submitting && setShowAddMemberModal(false)} />
          <div className="relative w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-700 dark:bg-slate-800">
            <h3 className="mb-4 text-lg font-bold text-slate-900 dark:text-slate-100">Register Gym Profile</h3>
            <form onSubmit={handleAddMember} className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">Full Name</label>
                  <input type="text" required value={newMember.name} onChange={(e) => setNewMember(p => ({ ...p, name: e.target.value }))} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">WhatsApp Phone</label>
                  <input type="tel" required value={newMember.phone} onChange={(e) => setNewMember(p => ({ ...p, phone: e.target.value }))} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100" placeholder="919876543210" />
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">Date of Birth</label>
                  <input type="date" required value={newMember.dob} onChange={(e) => setNewMember(p => ({ ...p, dob: e.target.value }))} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">Gender</label>
                  <select value={newMember.gender} onChange={(e) => setNewMember(p => ({ ...p, gender: e.target.value }))} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100">
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">Membership Tier</label>
                  <select value={newMember.membership_type} onChange={(e) => setNewMember(p => ({ ...p, membership_type: e.target.value }))} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100">
                    <option value="daily">Daily - ₹150</option>
                    <option value="monthly">Monthly - ₹1,500</option>
                    <option value="3months">3 Months - ₹4,000</option>
                    <option value="6months">6 Months - ₹5,500</option>
                    <option value="yearly">Yearly - ₹9,000</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">Joining Date</label>
                  <input type="date" required value={newMember.joining_date} onChange={(e) => setNewMember(p => ({ ...p, joining_date: e.target.value }))} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100" />
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">Class Timing</label>
                  <select value={newMember.class_timing} onChange={(e) => setNewMember(p => ({ ...p, class_timing: e.target.value }))} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100">
                    <option value="Morning (6 AM - 9 AM)">Morning (6 AM - 9 AM)</option>
                    <option value="Mid-day (11 AM - 2 PM)">Mid-day (11 AM - 2 PM)</option>
                    <option value="Evening (4 PM - 8 PM)">Evening (4 PM - 8 PM)</option>
                    <option value="Night (8 PM - 10 PM)">Night (8 PM - 10 PM)</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">Personal Trainer (PT)</label>
                  <input type="text" value={newMember.trainer_name} onChange={(e) => setNewMember(p => ({ ...p, trainer_name: e.target.value }))} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100" placeholder="None" />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">Residential Address</label>
                <textarea rows={2} required value={newMember.address} onChange={(e) => setNewMember(p => ({ ...p, address: e.target.value }))} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100" />
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowAddMemberModal(false)} disabled={submitting} className="flex-1 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 dark:border-slate-600 dark:text-slate-300">Cancel</button>
                <button type="submit" disabled={submitting} className="flex-1 rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white dark:bg-slate-600">{submitting ? 'Registering...' : 'Register Profile'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Equipment Modal */}
      {showAddEquipmentModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => !submitting && setShowAddEquipmentModal(false)} />
          <div className="relative w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-700 dark:bg-slate-800">
            <h3 className="mb-4 text-lg font-bold text-slate-900 dark:text-slate-100">Add Gym Equipment</h3>
            <form onSubmit={handleAddEquipment} className="space-y-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">Equipment Name</label>
                <input type="text" required value={newEquipment.name} onChange={(e) => setNewEquipment(p => ({ ...p, name: e.target.value }))} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100" placeholder="e.g. Leg Press Machine" />
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">Date of Addition</label>
                  <input type="date" required value={newEquipment.added_date} onChange={(e) => setNewEquipment(p => ({ ...p, added_date: e.target.value }))} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">Supervisor Name</label>
                  <input type="text" required value={newEquipment.supervisor} onChange={(e) => setNewEquipment(p => ({ ...p, supervisor: e.target.value }))} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100" placeholder="e.g. Subham" />
                </div>
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowAddEquipmentModal(false)} disabled={submitting} className="flex-1 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 dark:border-slate-600 dark:text-slate-300">Cancel</button>
                <button type="submit" disabled={submitting} className="flex-1 rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white dark:bg-slate-600">{submitting ? 'Saving...' : 'Add Equipment'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

function OverviewCard({ title, value, icon, color }) {
  const colorMap = {
    blue: 'border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-900/20',
    amber: 'border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/20',
    red: 'border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/20',
  }
  return (
    <div className={`rounded-xl border p-5 ${colorMap[color]}`}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-slate-600 dark:text-slate-400">{title}</p>
          <p className="mt-1 text-3xl font-bold text-slate-900 dark:text-slate-100">{value}</p>
        </div>
        <span className="text-2xl">{icon}</span>
      </div>
    </div>
  )
}

export default function DashboardPage() {
  return (
    <AuthGuard>
      <GymDashboard />
    </AuthGuard>
  )
}
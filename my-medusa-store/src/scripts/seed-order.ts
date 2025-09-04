/**
 * seed-order.ts (Medusa v2.9.0)
 * -------------------------------------------------------------
 * Creates two demo orders in a running Medusa backend:
 *   1) Fully fulfilled order (created via Store API → fulfilled via Admin API)
 *   2) Returned & refunded order (create → return → receive → refund)
 *
 * Requirements
 * - Medusa v2.x backend running
 * - At least one Region, one Product with a Variant, and a non-return Shipping Option
 * - Store API requires a Publishable key (scopes to a Sales Channel)
 * - Admin auth via JWT (from /auth/user/emailpass) OR a secret API key (sk_...)
 *
 * Usage
 *   set MEDUSA_BACKEND_URL=http://localhost:9000
 *   set MEDUSA_ADMIN_API_TOKEN=<JWT or sk_...>
 *   set PUBLISHABLE_KEY=pk_...
 *   npx tsx src/scripts/seed-order.ts
 */

import 'dotenv/config'

// Node 18+ includes global fetch.

type Json = Record<string, any>

const BASE_URL = (process.env.MEDUSA_BACKEND_URL || 'http://localhost:9000').replace(/\/$/, '')
const ADMIN_TOKEN = process.env.MEDUSA_ADMIN_API_TOKEN || ''
const DEMO_EMAIL = process.env.DEMO_EMAIL || 'demo@example.com'
const PUBLISHABLE_KEY =
  process.env.PUBLISHABLE_KEY ||
  process.env.MEDUSA_PUBLISHABLE_API_KEY ||
  process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY ||
  ''

if (!ADMIN_TOKEN) console.warn('[WARN] MEDUSA_ADMIN_API_TOKEN not set. Admin calls will fail.')
if (!PUBLISHABLE_KEY) console.warn('[WARN] PUBLISHABLE_KEY not set. Store API calls may fail.')

function adminHeaders(extra: Record<string, string> = {}) {
  const token = ADMIN_TOKEN
  const h: Record<string, string> = { 'Content-Type': 'application/json', ...extra }
  if (token) {
    if (token.startsWith('sk_')) {
      // Secret API key — support both styles for broader compatibility
      h['x-medusa-access-token'] = token
      h['Authorization'] = `Bearer ${token}`
    } else {
      // Admin JWT
      h['Authorization'] = `Bearer ${token}`
    }
  }
  return h
}

function storeHeaders(extra: Record<string, string> = {}) {
  const h: Record<string, string> = {
    'Content-Type': 'application/json',
    ...extra,
  }
  if (PUBLISHABLE_KEY) h['x-publishable-api-key'] = PUBLISHABLE_KEY
  return h
}

async function api<T = any>(path: string, opts: RequestInit = {}, isAdmin = false): Promise<T> {
  const url = `${BASE_URL}${path}`
  const headers = isAdmin ? adminHeaders(opts.headers as any) : storeHeaders(opts.headers as any)
  const res = await fetch(url, { ...opts, headers })
  const text = await res.text()
  let json: any = undefined
  try { json = text ? JSON.parse(text) : undefined } catch {}
  if (!res.ok) {
    const msg = json?.message || json?.error || text || res.statusText
    throw new Error(`[${res.status}] ${msg} — ${url}`)
  }
  return (json ?? ({} as any)) as T
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const first = <T = any>(arr?: T[]): T | null => (arr && arr.length ? (arr[0] as any) : null)

async function ensureBasics() {
  // 1) Region
  const regionsRes = await api<{ regions: any[] }>(`/admin/regions?limit=50`, { method: 'GET' }, true)
  const region = first(regionsRes.regions)
  if (!region) throw new Error('No regions found. Seed base data first.')

  // 2) Product variant
  const prodsRes = await api<{ products: any[] }>(`/admin/products?limit=50`, { method: 'GET' }, true)
  const prod = first(prodsRes.products)
  const variant = prod?.variants?.[0]
  if (!variant) throw new Error('No product variant found. Add a product with at least one variant.')

  // 3) Shipping option for non-return shipments
  const soRes = await api<{ shipping_options: any[] }>(`/admin/shipping-options?limit=50`, { method: 'GET' }, true)
  const shippingOption = (soRes.shipping_options || []).find((s: any) => !s.is_return && (!s.region_id || s.region_id === region.id)) || first(soRes.shipping_options)
  if (!shippingOption) throw new Error('No shipping option found. Create one in the Admin.')

  // 4) Sales channel (optional; v2 usually derives from publishable key but some setups require explicit id)
  let salesChannel: any = null
  try {
    const scRes = await api<{ sales_channels: any[] }>(`/admin/sales-channels?limit=50`, { method: 'GET' }, true)
    salesChannel = first(scRes.sales_channels)
  } catch {}

  // Optional: stock location for fulfillment
  let location: any = null
  try {
    const locRes = await api<{ stock_locations: any[] }>(`/admin/stock-locations?limit=50`, { method: 'GET' }, true)
    location = first(locRes.stock_locations)
  } catch {}

  return { region, variant, shippingOption, location, salesChannel }
}

async function getManualProviderId(regionId: string) {
  // Try to pick a provider id that represents manual/system; fall back to 'manual'
  try {
    const res = await api<{ payment_providers: Array<{ id: string }> }>(`/store/payment-providers?region_id=${encodeURIComponent(regionId)}`)
    const ids = (res.payment_providers || []).map((p) => p.id)
    const pick = ids.find((id) => id.toLowerCase().includes('manual')) || ids.find((id) => id.toLowerCase().includes('system')) || ids[0]
    return pick || 'manual'
  } catch {
    return 'manual'
  }
}

async function createOrderViaStore({ region, variant, shippingOption, salesChannel }: { region: any; variant: any; shippingOption: any; salesChannel?: any }) {
  // 1) Create cart (v2: do not send country_code at creation)
  const cartRes = await api<{ cart: any }>(`/store/carts`, {
    method: 'POST',
    body: JSON.stringify({
      region_id: region.id,
      ...(salesChannel ? { sales_channel_id: salesChannel.id } : {}),
    }),
  })
  const cart = cartRes.cart

  // 2) Add line item
  await api(`/store/carts/${cart.id}/line-items`, {
    method: 'POST',
    body: JSON.stringify({ variant_id: variant.id, quantity: 1 }),
  })

  // 3) Set addresses + email
  const countryCode = region.countries?.[0]?.iso_2 || region.countries?.[0]?.iso2 || 'us'
  const address = {
    first_name: 'Demo',
    last_name: 'Customer',
    address_1: '1 Seed St',
    city: 'Seedville',
    country_code: countryCode,
    postal_code: '10000',
  }
  await api(`/store/carts/${cart.id}`, {
    method: 'POST',
    body: JSON.stringify({
      shipping_address: address,
      billing_address: address,
      email: DEMO_EMAIL,
    }),
  })

  // 4) Add shipping method
  await api(`/store/carts/${cart.id}/shipping-methods`, {
    method: 'POST',
    body: JSON.stringify({ option_id: shippingOption.id }),
  })

  // 5) v2 payment flow — create payment collection → init session → authorize
  const pcRes = await api<{ payment_collection: any }>(`/store/payment-collections`, {
    method: 'POST',
    body: JSON.stringify({ cart_id: cart.id }),
  })
  const pc = (pcRes as any).payment_collection || pcRes

  const providerId = await getManualProviderId(region.id)
  const initRes = await api<{ payment_collection: any }>(`/store/payment-collections/${pc.id}/sessions`, {
    method: 'POST',
    body: JSON.stringify({ sessions: [{ provider_id: providerId }] }),
  })
  const sessions = ((initRes as any).payment_collection || initRes).payment_sessions || []
  const session = first(sessions)
  if (!session) throw new Error('Could not initialize a payment session for the payment collection')

  await api(`/store/payment-collections/${pc.id}/sessions/${session.id}/authorize`, { method: 'POST' })

  // 6) Complete cart -> returns order
  const complete = await api<{ type?: string; data?: any; order?: any }>(`/store/carts/${cart.id}/complete`, { method: 'POST' })
  const order = (complete as any).order || (complete.type === 'order' ? complete.data : null)
  if (!order) throw new Error('Cart completion did not return an order (payment?)')

  return order
}

async function fulfillOrder(orderId: string, locationId?: string) {
  const ordRes = await api<{ order: any }>(`/admin/orders/${orderId}`, { method: 'GET' }, true)
  const order = ordRes.order

  const items = order.items.map((it: any) => ({ item_id: it.id, quantity: it.quantity }))
  const body: Json = { items }
  if (locationId) body.location_id = locationId

  const fRes = await api<{ fulfillment: any }>(`/admin/orders/${orderId}/fulfillments`, {
    method: 'POST',
    body: JSON.stringify(body),
  }, true)

  const fulfillment = (fRes as any).fulfillment || (fRes as any)

  // Optional: mark as shipped
  try {
    await api(`/admin/orders/${orderId}/shipment`, {
      method: 'POST',
      body: JSON.stringify({ fulfillment_id: fulfillment.id, tracking_numbers: ['TRACK-DEMO-0001'] }),
    }, true)
  } catch (e) {
    console.warn('[WARN] shipment step failed (may differ by version)', (e as Error).message)
  }
}

async function returnAndRefund(orderId: string) {
  const ordRes = await api<{ order: any }>(`/admin/orders/${orderId}`, { method: 'GET' }, true)
  const order = ordRes.order

  const item = order.items?.[0]
  if (!item) throw new Error('Order has no items to return.')

  const retBody: Json = {
    order_id: order.id,
    items: [{ item_id: item.id, quantity: item.quantity }],
    refund: true,
  }

  const retRes = await api<{ return: any }>(`/admin/returns`, { method: 'POST', body: JSON.stringify(retBody) }, true)
  const ret = (retRes as any).return || (retRes as any)

  try {
    await api(`/admin/returns/${ret.id}/receive`, { method: 'POST', body: JSON.stringify({ items: [{ item_id: item.id, quantity: item.quantity }] }) }, true)
  } catch (e) {
    console.warn('[WARN] return receive step failed (may differ by version)', (e as Error).message)
  }
}

async function main() {
  console.log('→ Checking basics...')
  const { region, variant, shippingOption, location, salesChannel } = await ensureBasics()
  console.log('   Region:', region.name, `(${region.id})`)
  console.log('   Variant:', variant.title || variant.id)
  console.log('   Shipping option:', shippingOption.name || shippingOption.id)

  // 1) Create and fulfill order
  console.log('→ Creating Order A (to fully fulfill)...')
  const orderA = await createOrderViaStore({ region, variant, shippingOption, salesChannel })
  console.log('   Created order:', orderA.id)
  await sleep(250)
  console.log('→ Fulfilling Order A...')
  await fulfillOrder(orderA.id, location?.id)
  console.log('   Order A fulfilled (and shipped if supported).')

  // 2) Create order B and process a return + refund
  console.log('→ Creating Order B (to return & refund)...')
  const orderB = await createOrderViaStore({ region, variant, shippingOption, salesChannel })
  console.log('   Created order:', orderB.id)
  await sleep(250)
  console.log('→ Filing and receiving a return for Order B...')
  await returnAndRefund(orderB.id)
  console.log('   Order B returned (and refunded if supported).')

  console.log('✅ Done. Check your Admin → Orders to verify statuses.')
}

main().catch((err) => {
  console.error('❌ Seed failed:', err.message)
  process.exitCode = 1
})

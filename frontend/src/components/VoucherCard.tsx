export interface CardElement {
  id: string
  field: 'text' | 'price' | 'code' | 'serial_number' | 'plan_name' | 'username' | 'password' | 'image'
  text?: string
  x: number            // % of width
  y: number            // % of height
  font_size: number    // design px relative to template.width
  color: string
  weight: number
  align: 'left' | 'center' | 'right'
  underline?: boolean
  letter_spacing?: number
  font: 'sans' | 'mono'
  shadow?: boolean
  image_data?: string  // data URI for field === 'image'
  width?: number       // image width as % of card width
}

export interface CardTemplate {
  width: number
  height: number
  background_data: string | null
  elements: CardElement[]
}

interface VoucherCardProps {
  code: string
  serialNumber?: string
  planName?: string
  price?: number | string | null
  username?: string
  password?: string
  size?: number          // rendered width in px
  template: CardTemplate
}

function resolve(el: CardElement, v: { code: string; serialNumber?: string; planName?: string; price?: number | string | null; username?: string; password?: string }): string {
  switch (el.field) {
    case 'price':
      return v.price != null && Number(v.price) > 0
        ? `Rs. ${Number(v.price).toLocaleString('en-NP', { minimumFractionDigits: 0 })}`
        : ''
    case 'code': return v.code ?? ''
    case 'serial_number': return v.serialNumber ?? ''
    case 'plan_name': return v.planName ?? ''
    case 'username': return v.username ?? ''
    case 'password': return v.password ?? ''
    default: return el.text ?? ''
  }
}

/**
 * Prepaid WiFi voucher card rendered from an admin-configured template:
 * a background image with absolutely-positioned text elements. Positions are
 * percentages so the same design scales to any preview/print size.
 */
export function VoucherCard(props: VoucherCardProps) {
  const { size = 280, template } = props
  const W = size
  const scale = W / template.width
  const H = Math.round(W * (template.height / template.width))
  const bg = template.background_data || '/voucher-card-bg.png'

  return (
    <div
      style={{
        width: W,
        height: H,
        position: 'relative',
        overflow: 'hidden',
        borderRadius: Math.round(W * 0.038),
        boxShadow: '0 8px 32px rgba(0,0,0,0.22)',
        flexShrink: 0,
        userSelect: 'none',
      }}
    >
      <img
        src={bg}
        alt=""
        draggable={false}
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          zIndex: 0,
          pointerEvents: 'none',
        }}
      />

      <div style={{ position: 'relative', zIndex: 10, width: '100%', height: '100%' }}>
        {template.elements.map((el) => {
          const translateX = el.align === 'right' ? '-100%' : el.align === 'center' ? '-50%' : '0'

          if (el.field === 'image') {
            if (!el.image_data) return null
            return (
              <img
                key={el.id}
                src={el.image_data}
                alt=""
                draggable={false}
                style={{
                  position: 'absolute',
                  left: `${el.x}%`,
                  top: `${el.y}%`,
                  transform: `translateX(${translateX})`,
                  width: `${(el.width || 20) * (W / 100)}px`,
                  height: 'auto',
                  filter: el.shadow ? 'drop-shadow(0 1px 4px rgba(0,0,0,0.45))' : 'none',
                }}
              />
            )
          }

          const text = resolve(el, props)
          if (!text) return null
          return (
            <div
              key={el.id}
              style={{
                position: 'absolute',
                left: `${el.x}%`,
                top: `${el.y}%`,
                transform: `translateX(${translateX})`,
                whiteSpace: 'nowrap',
                fontSize: el.font_size * scale,
                color: el.color,
                fontWeight: el.weight,
                textAlign: el.align,
                textDecoration: el.underline ? 'underline' : 'none',
                letterSpacing: (el.letter_spacing || 0) * scale,
                fontFamily: el.font === 'mono' ? 'monospace' : 'sans-serif',
                lineHeight: 1.1,
                textShadow: el.shadow ? '0 1px 4px rgba(0,0,0,0.45)' : 'none',
              }}
            >
              {text}
            </div>
          )
        })}
      </div>
    </div>
  )
}

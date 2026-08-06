# Ediz Okul Parası

Kardeşin için okul parası toplayan ailelerin kullandığı mobil uyumlu takip sitesi.

- Hedef tutar (₺) ve kalan miktar
- TL veya USD ödeme kaydı
- USD → TL: **TCMB döviz alış** (seçilen tarihin iş günü bülteni)
- Aynı linkten aile paylaşımı (Firebase — sunucu tutmana gerek yok)
- GitHub Pages ile kalıcı ücretsiz adres

## Canlı site

GitHub → **Settings → Pages** → Source: **GitHub Actions** seçildikten sonra:

`https://dogankosakk-tech.github.io/edizokul/`

## Kullanım

1. Siteyi aç → hedef tutarı gir → **Fon oluştur**
2. Aileyle paylaşmak için **Paylaşım kurulumu** (tek sefer, ~5 dk)
3. **Aile linkini** WhatsApp’tan gönder — diğer üyelerin kurulum yapması gerekmez
4. **Ödeme ekle** ile TL/USD kayıtlarını gir

Firebase olmadan da (yerel mod) tek cihazda çalışır.

## Paylaşım kurulumu

1. [Firebase Console](https://console.firebase.google.com/) → proje oluştur
2. **Realtime Database** aç (`europe-west1`)
3. Web uygulaması ekle → `firebaseConfig` değerlerini sitedeki forma yapıştır
4. Rules:

```json
{
  "rules": {
    "rooms": {
      "$roomId": {
        ".read": true,
        ".write": true
      }
    }
  }
}
```

Link yalnızca güvendiğin aile üyeleriyle paylaşılmalı.

## Kur kaynağı

| Öncelik | Kaynak |
|--------|--------|
| 1 | `rates/*.json` — TCMB önbelleği (Actions ile güncellenir) |
| 2 | TCMB XML (iş günü bülteni) |
| 3 | currency-api (yedek) |
| 4 | Elle düzeltme |

**ForexBuying (döviz alış)** kullanılır. Google orta piyasa/satış kurundan genelde daha düşüktür. Hafta sonu/tatilde önceki iş günü alınır. Saatlik serbest piyasa farkı için kur alanını elle düzeltebilirsin.

## Yerel geliştirme

```bash
python3 -m http.server 8080
```

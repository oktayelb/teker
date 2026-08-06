# Teker.

 Yarış oyunu. 

 mu acaba?

---

## Çalıştırmak için

Node.js ve Python 3 gerekiyor.

```bash
git clone https://github.com/oktayelb/teker.git
cd teker
npm install
npm run dev
```

Sonra tarayıcıda [http://localhost:8000](http://localhost:8000) adresini aç.

Sürüş: `W A S D` ya da yön tuşları · `Space` el freni · `Esc` menü.

`H` harita · `Shift`+`H` yakınlaştırma · `C` kamera · `F` farlar · `B` korna.


---

## Bölümler


Her bölümün kendi haritası, kendi havası ve kendi şarkısı var.

| # | Bölüm | Yer | Şarkı (gam) |
|---|-------|-----|-------------|
| 1 | Çam Halkası | geniş oval, çam ormanı | dorian — ılık minör, önü açık |
| 2 | Dere Geçidi | 34 m iniş-çıkış, yarım kalmış asfalt | miksolidyen — parlak, b7 şekeri alır |
| 3 | Sırt Yolu | gece, stabilize yol, projektör direkleri | eolyen — düz minör, ağıt olmayacak kadar hızlı |
| 4 | Taşocağı | gün batımı, iki firkete, 46 m'lik taş ocağı | frigyen dominant (hicaz) — artık ikili: sıcak ve toz |
| 5 | Göl Kıyısı | yağmur, ıslak asfalt, gölün etrafında tam tur | kumoi + tam ses — durgun su, üstünde yağmur |
| 6 | Viyadük | sis; yol havalanır, vadiyi geçer, spiral inişle döner | lidyen — yükseltilmiş 4, yani yükseklik |
| 7 | Kar Hattı | kar, beyaz zemin, gölgede kalan virajlarda buz | hirajoshi + tam ses — durgunluk, ve soğuk |
| 8 | Kapak | fırtına, gece, kil  | oktatonik — simetrik, evsiz; takibin kendi tonunda |
| 9 | Havai Hat | yarısı havada; köprü kendi yolunun üstünden geçer | frigyen — 4'ün b2'si, sıcağı alınmış |
| 10 | Son Halka | gece kar; diğer dokuzun sınavı | armonik minör — karara varan tek parça |

Menü, takip ve kapıdan çıktıktan sonrası bölüme değil oyuna ait: onlar sabit.

Şarkılar dosya değil — `src/audio/music/` altında gam dereceleriyle yazılmış,
çalışma anında osilatörlerden kuruluyor. Yeni şarkı: bir dosya, iki satır.
Gamların hangi duyguya oturduğu konusunda tutulan kaynaklar:
[Musical U](https://www.musical-u.com/learn/the-many-moods-of-musical-modes/) ·
[LANDR](https://blog.landr.com/music-modes/) ·
[Video Game Music Academy](https://www.videogamemusicacademy.com/composing-with-dorian-mode-guest-post-by-joshua-taipale/) ·
[Video Game Music Alliance](https://www.videogamemusicalliance.com/blog/how-to-use-modes-in-game-music) ·
[Fiveable: whole-tone & octatonic](https://library.fiveable.me/introduction-to-musicianship/unit-4/whole-tone-octatonic-scales/study-guide/QSqHvR1uBIB4kQaV) ·
[Music Interval Theory Academy](https://musicintervaltheory.academy/learn-how-to-write-music/octatonic-scale/) ·
[Film Music Theory: hirajoshi](https://filmmusictheory.com/article/composing-in-hirajoshi-scale/)

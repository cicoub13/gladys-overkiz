# Intégration Overkiz pour Gladys Assistant

Contrôlez vos appareils Overkiz depuis Gladys Assistant : les box Somfy TaHoma, TaHoma Switch, Connexoon, Atlantic Cozytouch, Rexel Energeasy Connect, Hitachi Hi Kumo et Bouygues Flexom sont supportées via l'API cloud Overkiz.

## Fonctionnalités

- **Volets et ouvrants** : volets roulants, stores, screens, stores vénitiens, rideaux, pergolas, portes de garage, portails et fenêtres — ouvrir, fermer, stopper et régler la position.
- **Lampes** : marche/arrêt et luminosité.
- **Interrupteurs et prises** : marche/arrêt.
- **Capteurs** : température, humidité, luminosité, contact (ouverture), présence (mouvement), fumée, fuite d'eau, CO2, puissance/consommation électrique et niveau de batterie.
- **Chauffe-eau** : mode de fonctionnement (éco, manuel, auto, absence), boost, température de consigne, eau chaude restante, chauffe en cours et température de l'eau. Nécessite **Gladys 4.85 ou supérieur**, version qui introduit la catégorie chauffe-eau.

Les états sont rafraîchis en quasi temps réel via l'API d'événements Overkiz : un volet actionné depuis une télécommande physique est reflété dans Gladys en quelques secondes.

## Ce qui n'est pas encore supporté

- **Chauffage** : radiateurs, planchers chauffants et pompes à chaleur (`HeatingSystem`) ne sont pas encore convertis en appareils Gladys. Les box **Atlantic Cozytouch**, **Thermor**, **Sauter** et **Hitachi Hi Kumo** se connectent bien et leurs chauffe-eau sont supportés, mais leurs appareils de chauffage n'apparaîtront pas encore dans la découverte.
- **Les chauffe-eau autres qu'Atlantic / Thermor / Sauter** sont convertis pour ce qu'ils rapportent, mais leurs commandes spécifiques (Hitachi Hi Kumo notamment) ne sont pas encore câblées : les capteurs fonctionneront, certaines commandes manqueront.
- **Serrures, alarmes et ventilation** (`DoorLock`, `Alarm`, `AirFlow`).
- Sur les prises et modules mesurant la consommation, Overkiz publie souvent la puissance sur un **sous-appareil** distinct : il apparaît alors comme un appareil séparé dans la découverte, portant le même nom que son parent.

## Prérequis

- Une box Overkiz (Somfy TaHoma, TaHoma Switch, Connexoon, Cozytouch...) déjà configurée avec l'application du fabricant.
- L'email et le mot de passe de votre compte fabricant (les mêmes identifiants que dans l'application TaHoma / Cozytouch).

## Configuration

1. Installez l'intégration depuis le store Gladys.
2. Ouvrez l'onglet **Configuration**.
3. Choisissez le **Serveur** correspondant à votre box (Somfy Europe pour TaHoma / TaHoma Switch / Connexoon en Europe).
4. Saisissez l'**email** et le **mot de passe** de votre compte, puis enregistrez.
5. Utilisez le bouton **Tester la connexion** pour vérifier vos identifiants.
6. Ouvrez l'onglet **Découverte**, lancez un scan, et créez les appareils souhaités dans Gladys.

## Dépannage

- **Connexion impossible** : vérifiez le serveur sélectionné et vos identifiants en vous connectant à l'application du fabricant. Somfy peut verrouiller temporairement le compte après trop de tentatives échouées.
- **Un appareil est absent** : seuls les types d'appareils listés ci-dessus sont supportés. Relancez un scan depuis l'onglet Découverte après avoir ajouté un appareil à votre box. Si votre appareil devrait être supporté mais ne l'est pas, utilisez l'action **Lister les appareils bruts** : elle écrit dans les logs de l'intégration ce qu'Overkiz dit de chacun de vos appareils, ce dont un mapping a besoin. Ce contenu comprend le numéro de série de votre box : anonymisez-le avant de le partager.
- **Les états semblent figés** : la période d'interrogation des événements peut être réduite dans l'onglet Configuration (10 s minimum). Attention, le cloud Overkiz limite les interrogations trop agressives.
- **Mon chauffe-eau propose moins de modes que l'appareil** : seuls les modes réellement exposés par votre appareil sont proposés. Le boost est une commande à part et non un mode, parce que c'est ainsi que ces appareils le rapportent.

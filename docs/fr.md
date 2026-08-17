# Intégration Overkiz pour Gladys Assistant

Contrôlez vos appareils Overkiz depuis Gladys Assistant : les box Somfy TaHoma, TaHoma Switch, Connexoon, Atlantic Cozytouch, Rexel Energeasy Connect, Hitachi Hi Kumo et Bouygues Flexom sont supportées via l'API cloud Overkiz.

## Fonctionnalités

- **Volets et ouvrants** : volets roulants, stores, screens, stores vénitiens, rideaux, pergolas, portes de garage, portails et fenêtres — ouvrir, fermer, stopper et régler la position.
- **Lampes** : marche/arrêt et luminosité.
- **Interrupteurs et prises** : marche/arrêt.
- **Capteurs** : température, humidité, luminosité, contact (ouverture), présence (mouvement), fumée, fuite d'eau, CO2 et puissance/consommation électrique.
- **Batterie** : sur tous les appareils qui la remontent, volets et lampes compris. Les appareils dotés d'une jauge publient un niveau en pourcentage ; ceux qui ne rapportent qu'un statut — la majorité des capteurs IO et RTS — publient à la place un indicateur « batterie faible ».
- **Chauffe-eau** : mode de fonctionnement (éco, manuel, auto, absence), boost, température de consigne, eau chaude restante (en litres soutirables à 40 °C), chauffe en cours et température de l'eau. Nécessite **Gladys 4.85 ou supérieur**, version qui introduit la catégorie chauffe-eau.

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

### Plusieurs comptes Overkiz

Overkiz fait tourner les box de plusieurs marques, et chaque marque gère son propre compte sur son
propre serveur. Si vous en avez plusieurs — une box Somfy pour vos volets et un compte Atlantic
Cozytouch pour un chauffe-eau Thermor, par exemple — renseignez la section **Compte Overkiz 2** (et
la 3 si besoin) avec son propre serveur, son email et son mot de passe. Les trois comptes
fonctionnent en parallèle et leurs appareils apparaissent dans la même liste de découverte.

Pour cesser d'utiliser un compte, videz son **email** et enregistrez. Évitez de choisir l'entrée
vide de la liste **Serveur** : ce n'est pas une valeur valide et l'enregistrement est refusé.

La **période d'interrogation des événements** est un réglage unique, partagé par tous les comptes.

## Dépannage

- **Connexion impossible** : vérifiez le serveur sélectionné et vos identifiants en vous connectant à l'application du fabricant. Somfy peut verrouiller temporairement le compte après trop de tentatives échouées.
- **Un seul de mes comptes se connecte** : le statut de connexion passe au rouge dès qu'un compte configuré échoue, et nomme le fautif — les autres continuent de fonctionner normalement. **Tester la connexion** détaille compte par compte.
- **Les appareils d'un deuxième compte ont disparu de la Découverte** : un compte momentanément déconnecté cesse d'y proposer ses appareils ; ceux que vous avez déjà créés dans Gladys ne bougent pas, et les autres reviennent à la reconnexion.
- **Un appareil est absent** : seuls les types d'appareils listés ci-dessus sont supportés. Relancez un scan depuis l'onglet Découverte après avoir ajouté un appareil à votre box. Si votre appareil devrait être supporté mais ne l'est pas, utilisez l'action **Lister les appareils bruts** : elle écrit dans les logs de l'intégration ce qu'Overkiz dit de chacun de vos appareils, ce dont un mapping a besoin. Ce contenu comprend le numéro de série de votre box : anonymisez-le avant de le partager.
- **Les états semblent figés** : la période d'interrogation des événements peut être réduite dans l'onglet Configuration (10 s minimum). Attention, le cloud Overkiz limite les interrogations trop agressives.
- **Mon chauffe-eau propose moins de modes que l'appareil** : seuls les modes réellement exposés par votre appareil sont proposés. Le boost est une commande à part et non un mode, parce que c'est ainsi que ces appareils le rapportent.

# Intégration Overkiz pour Gladys Assistant

Contrôlez vos appareils Overkiz depuis Gladys Assistant : les box Somfy TaHoma, TaHoma Switch, Connexoon, Atlantic Cozytouch, Rexel Energeasy Connect, Hitachi Hi Kumo et Bouygues Flexom sont supportées via l'API cloud Overkiz.

## Fonctionnalités

- **Volets et ouvrants** : volets roulants, stores, screens, stores vénitiens, rideaux, pergolas, portes de garage, portails et fenêtres — ouvrir, fermer, stopper et régler la position.
- **Lampes** : marche/arrêt et luminosité.
- **Interrupteurs et prises** : marche/arrêt, avec capteurs de puissance et de consommation quand ils existent.
- **Capteurs** : température, humidité, luminosité, contact (ouverture), présence (mouvement), fumée, fuite d'eau, CO2, puissance/consommation électrique et niveau de batterie.

Les états sont rafraîchis en quasi temps réel via l'API d'événements Overkiz : un volet actionné depuis une télécommande physique est reflété dans Gladys en quelques secondes.

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
- **Un appareil est absent** : seuls les types d'appareils listés ci-dessus sont supportés. Relancez un scan depuis l'onglet Découverte après avoir ajouté un appareil à votre box.
- **Les états semblent figés** : la période d'interrogation des événements peut être réduite dans l'onglet Configuration (10 s minimum). Attention, le cloud Overkiz limite les interrogations trop agressives.

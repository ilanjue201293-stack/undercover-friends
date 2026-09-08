export type WordPair = [string, string, string];

type WordGroup = { theme: string; pairs: Array<[string, string]> };

const GROUPS: WordGroup[] = [
  { theme: "Animaux", pairs: [
    ["Chat","Tigre"],["Chien","Loup"],["Lion","Panthère"],["Cheval","Zèbre"],["Lapin","Lièvre"],["Souris","Hamster"],
    ["Vache","Mouton"],["Chèvre","Mouton"],["Cochon","Sanglier"],["Gorille","Chimpanzé"],["Éléphant","Rhinocéros"],["Girafe","Autruche"],
    ["Renard","Loup"],["Ours","Panda"],["Koala","Panda"],["Cerf","Biche"],["Hérisson","Porc-épic"],["Loutre","Castor"],
    ["Kangourou","Wallaby"],["Dromadaire","Chameau"],["Lama","Alpaga"],["Âne","Cheval"],["Bison","Buffle"],["Furet","Belette"]
  ]},
  { theme: "Animaux marins", pairs: [
    ["Dauphin","Requin"],["Baleine","Orque"],["Poulpe","Calamar"],["Crabe","Homard"],["Méduse","Poulpe"],["Phoque","Otarie"],
    ["Tortue de mer","Raie"],["Hippocampe","Poisson-clown"],["Saumon","Thon"],["Sardine","Anchois"],["Étoile de mer","Oursin"],["Moule","Huître"]
  ]},
  { theme: "Oiseaux et insectes", pairs: [
    ["Aigle","Faucon"],["Poule","Canard"],["Pigeon","Mouette"],["Corbeau","Pie"],["Perroquet","Perruche"],["Hibou","Chouette"],
    ["Paon","Flamant rose"],["Cygne","Oie"],["Moineau","Rouge-gorge"],["Papillon","Libellule"],["Abeille","Guêpe"],["Fourmi","Termite"],
    ["Moustique","Mouche"],["Coccinelle","Scarabée"],["Araignée","Scorpion"],["Criquet","Sauterelle"]
  ]},
  { theme: "Nourriture et boissons", pairs: [
    ["Burger","Kebab"],["Pizza","Tarte"],["Pâtes","Riz"],["Frites","Chips"],["Tacos","Burrito"],["Sushi","Maki"],
    ["Hot-dog","Burger"],["Poulet","Dinde"],["Steak","Escalope"],["Saumon","Thon"],["Omelette","Œuf au plat"],["Soupe","Purée"],
    ["Sandwich","Panini"],["Quiche","Pizza"],["Couscous","Tajine"],["Paella","Risotto"],["Raclette","Fondue"],["Lasagnes","Gratin"]
  ]},
  { theme: "Nourriture et boissons", pairs: [
    ["Coca-Cola","Pepsi"],["Sprite","7Up"],["Eau","Limonade"],["Café","Thé"],["Chocolat chaud","Café"],["Jus d'orange","Jus de pomme"],
    ["Milkshake","Smoothie"],["Sirop","Soda"],["Eau gazeuse","Eau plate"],["Espresso","Cappuccino"],["Thé glacé","Limonade"],["Boisson énergisante","Soda"]
  ]},
  { theme: "Desserts et sucreries", pairs: [
    ["Glace","Sorbet"],["Gâteau","Tarte"],["Cookie","Brownie"],["Donut","Muffin"],["Crêpe","Gaufre"],["Macaron","Meringue"],
    ["Bonbon","Chewing-gum"],["Chocolat","Caramel"],["Nutella","Confiture"],["Miel","Sirop d'érable"],["Éclair","Mille-feuille"],["Tiramisu","Cheesecake"],
    ["Flan","Crème brûlée"],["Compote","Yaourt"],["Churros","Beignet"],["Pain perdu","Brioche"]
  ]},
  { theme: "Fruits et légumes", pairs: [
    ["Pomme","Poire"],["Fraise","Framboise"],["Citron","Orange"],["Pastèque","Melon"],["Pêche","Abricot"],["Cerise","Raisin"],
    ["Banane","Mangue"],["Ananas","Mangue"],["Kiwi","Fruit de la passion"],["Clémentine","Mandarine"],["Myrtille","Cassis"],["Noix","Noisette"],
    ["Carotte","Concombre"],["Tomate","Poivron"],["Courgette","Aubergine"],["Brocoli","Chou-fleur"],["Salade","Épinard"],["Oignon","Échalote"]
  ]},
  { theme: "Cuisine et vaisselle", pairs: [
    ["Fourchette","Cuillère"],["Couteau","Ciseaux"],["Assiette","Bol"],["Verre","Tasse"],["Poêle","Casserole"],["Four","Micro-ondes"],
    ["Frigo","Congélateur"],["Mixeur","Blender"],["Grille-pain","Bouilloire"],["Éponge","Torchon"],["Passoire","Égouttoir"],["Planche à découper","Plateau"],
    ["Ketchup","Mayonnaise"],["Sel","Poivre"],["Huile","Vinaigre"],["Farine","Sucre"]
  ]},
  { theme: "Maison", pairs: [
    ["Canapé","Fauteuil"],["Lit","Canapé"],["Douche","Baignoire"],["Fenêtre","Porte"],["Lampe","Bougie"],["Table","Bureau"],
    ["Chaise","Tabouret"],["Armoire","Commode"],["Oreiller","Coussin"],["Couette","Plaid"],["Tapis","Moquette"],["Rideau","Store"],
    ["Balcon","Terrasse"],["Garage","Cave"],["Escalier","Ascenseur"],["Clé","Serrure"],["Aspirateur","Balai"],["Machine à laver","Sèche-linge"]
  ]},
  { theme: "Technologie", pairs: [
    ["Téléphone","Tablette"],["Ordinateur","Console"],["Clavier","Piano"],["Souris","Trackpad"],["AirPods","Casque"],["Écran","Télévision"],
    ["Télécommande","Manette"],["Webcam","Caméra"],["Micro","Enceinte"],["Chargeur","Batterie externe"],["USB","HDMI"],["Wi-Fi","Bluetooth"],
    ["Imprimante","Scanner"],["Disque dur","SSD"],["PC portable","PC fixe"],["Smartwatch","Bracelet connecté"],["VR","AR"],["Routeur","Box internet"]
  ]},
  { theme: "Applications et réseaux sociaux", pairs: [
    ["YouTube","TikTok"],["Instagram","Snapchat"],["Discord","WhatsApp"],["Messenger","WhatsApp"],["Telegram","Signal"],["X","Threads"],
    ["Reddit","Quora"],["Pinterest","Instagram"],["Twitch","YouTube"],["BeReal","Snapchat"],["LinkedIn","Facebook"],["CapCut","InShot"],
    ["Google Maps","Waze"],["Uber","Bolt"],["Deliveroo","Uber Eats"],["Vinted","Leboncoin"],["Shazam","Spotify"],["Gmail","Outlook"]
  ]},
  { theme: "Internet et logiciels", pairs: [
    ["Google","Bing"],["Chrome","Firefox"],["Safari","Edge"],["Windows","macOS"],["Android","iOS"],["Word","Google Docs"],
    ["PowerPoint","Canva"],["Excel","Google Sheets"],["Photoshop","GIMP"],["Notion","Trello"],["Zoom","Google Meet"],["GitHub","GitLab"],
    ["ChatGPT","Gemini"],["Vercel","Netlify"],["Dropbox","Google Drive"],["iCloud","Google Drive"]
  ]},
  { theme: "Streaming et médias", pairs: [
    ["Netflix","Disney+"],["Prime Video","Netflix"],["Canal+","Netflix"],["Spotify","Deezer"],["Apple Music","Spotify"],["SoundCloud","Spotify"],
    ["YouTube Music","Spotify"],["Crunchyroll","Netflix"],["Twitch","Kick"],["Podcast","Radio"],["Film","Série"],["Replay","Direct"]
  ]},
  { theme: "Jeux vidéo", pairs: [
    ["Roblox","Minecraft"],["Fortnite","Apex Legends"],["Valorant","CS2"],["Call of Duty","Battlefield"],["GTA","Red Dead Redemption"],["Rocket League","EA Sports FC"],
    ["Overwatch","Valorant"],["Fall Guys","Stumble Guys"],["Among Us","Undercover"],["Terraria","Minecraft"],["Brawl Stars","Clash Royale"],["Clash of Clans","Boom Beach"],
    ["Mario Kart","Crash Team Racing"],["Pokémon","Palworld"],["The Sims","Animal Crossing"],["Geometry Dash","Subway Surfers"],["Candy Crush","2048"],["League of Legends","Dota 2"]
  ]},
  { theme: "Consoles et personnages de jeux", pairs: [
    ["PlayStation","Xbox"],["Nintendo Switch","Steam Deck"],["Mario","Sonic"],["Luigi","Mario"],["Link","Zelda"],["Pikachu","Évoli"],
    ["Steve","Alex"],["Kratos","Thor"],["Master Chief","Doom Slayer"],["Lara Croft","Nathan Drake"],["Pac-Man","Kirby"],["Donkey Kong","Bowser"]
  ]},
  { theme: "Sport", pairs: [
    ["Football","Basket"],["Tennis","Badminton"],["Boxe","Karaté"],["Natation","Plongée"],["Ski","Snowboard"],["Rugby","Football américain"],
    ["Handball","Basket"],["Volley","Beach-volley"],["Judo","Karaté"],["Escalade","Alpinisme"],["Surf","Bodyboard"],["Skateboard","BMX"],
    ["Golf","Mini-golf"],["Ping-pong","Tennis"],["Athlétisme","Triathlon"],["Formule 1","MotoGP"],["Hockey","Patinage"],["Escrime","Kendo"]
  ]},
  { theme: "Sport", pairs: [
    ["Ballon","Balle"],["Raquette","Club de golf"],["But","Panier"],["Stade","Gymnase"],["Arbitre","Entraîneur"],["Médaille","Trophée"],
    ["Maillot","Short"],["Casque","Protège-tibias"],["Chronomètre","Sifflet"],["Échauffement","Étirement"],["Penalty","Coup franc"],["Sprint","Marathon"]
  ]},
  { theme: "Transport", pairs: [
    ["Vélo","Trottinette"],["Voiture","Moto"],["Bus","Tramway"],["Métro","Train"],["Avion","Hélicoptère"],["Bateau","Sous-marin"],
    ["Taxi","Uber"],["TGV","RER"],["Ferry","Paquebot"],["Camion","Fourgon"],["Scooter","Moto"],["Monorail","Métro"],
    ["Montgolfière","Parapente"],["Jet-ski","Bateau"],["Camping-car","Caravane"],["Skateboard","Trottinette"]
  ]},
  { theme: "Voyage et lieux", pairs: [
    ["Plage","Piscine"],["Mer","Lac"],["Montagne","Colline"],["Forêt","Jungle"],["Désert","Savane"],["Île","Presqu'île"],
    ["Hôtel","Camping"],["Aéroport","Gare"],["Restaurant","Café"],["Musée","Galerie"],["Parc","Jardin"],["Château","Palais"],
    ["Village","Ville"],["Centre-ville","Banlieue"],["Port","Marina"],["Zoo","Aquarium"]
  ]},
  { theme: "Pays et villes", pairs: [
    ["Paris","Londres"],["New York","Los Angeles"],["Rome","Milan"],["Madrid","Barcelone"],["Tokyo","Séoul"],["Dubaï","Abu Dhabi"],
    ["Berlin","Munich"],["Lisbonne","Porto"],["Athènes","Rome"],["Montréal","Toronto"],["Sydney","Melbourne"],["Rio","São Paulo"],
    ["France","Belgique"],["Italie","Espagne"],["Japon","Corée du Sud"],["Canada","États-Unis"],["Grèce","Croatie"],["Maroc","Tunisie"]
  ]},
  { theme: "École", pairs: [
    ["École","Collège"],["Collège","Lycée"],["Professeur","Surveillant"],["Cahier","Classeur"],["Stylo","Crayon"],["Gomme","Correcteur"],
    ["Règle","Équerre"],["Maths","Physique"],["Histoire","Géographie"],["SVT","Physique"],["Récréation","Pause"],["Cantine","Cafétéria"],
    ["Devoir","Contrôle"],["Note","Moyenne"],["Tableau","Projecteur"],["Sac à dos","Cartable"],["Bibliothèque","CDI"],["Principal","Professeur"]
  ]},
  { theme: "Vêtements et accessoires", pairs: [
    ["T-shirt","Chemise"],["Jean","Jogging"],["Short","Bermuda"],["Pull","Sweat"],["Veste","Manteau"],["Baskets","Chaussures"],
    ["Casquette","Bonnet"],["Écharpe","Foulard"],["Gants","Moufles"],["Ceinture","Bretelles"],["Montre","Bracelet"],["Collier","Chaîne"],
    ["Lunettes","Lentilles"],["Sac à dos","Sac à main"],["Pyjama","Peignoir"],["Costume","Smoking"]
  ]},
  { theme: "Cinéma et séries", pairs: [
    ["Cinéma","Théâtre"],["Film","Série"],["Acteur","Réalisateur"],["Comédie","Drame"],["Horreur","Thriller"],["Animation","Dessin animé"],
    ["Spider-Man","Batman"],["Iron Man","Superman"],["Hulk","Thor"],["Joker","Thanos"],["Harry Potter","Mercredi"],["Star Wars","Star Trek"],
    ["Stranger Things","Wednesday"],["Squid Game","Alice in Borderland"],["The Rookie","Chicago PD"],["Avatar","Titanic"],["Toy Story","Cars"],["Shrek","Madagascar"]
  ]},
  { theme: "Musique", pairs: [
    ["Rap","Pop"],["Rock","Metal"],["Jazz","Blues"],["Techno","House"],["Guitare","Basse"],["Piano","Synthé"],
    ["Batterie","Percussions"],["Violon","Violoncelle"],["Flûte","Clarinette"],["Concert","Festival"],["Chanteur","Rappeur"],["DJ","Producteur"],
    ["Album","Playlist"],["Refrain","Couplet"],["Micro","Karaoké"],["Casque","Enceinte"]
  ]},
  { theme: "Livres et création", pairs: [
    ["Livre","BD"],["Manga","Comics"],["Journal","Magazine"],["Roman","Nouvelle"],["Poème","Chanson"],["Auteur","Scénariste"],
    ["Photo","Vidéo"],["Dessin","Peinture"],["Crayon","Pinceau"],["Appareil photo","Caméra"],["Montage","Retouche"],["Affiche","Logo"]
  ]},
  { theme: "Métiers", pairs: [
    ["Police","Gendarmerie"],["Pompier","Ambulancier"],["Médecin","Infirmier"],["Dentiste","Orthodontiste"],["Professeur","Éducateur"],["Avocat","Juge"],
    ["Boulanger","Pâtissier"],["Cuisinier","Serveur"],["Coiffeur","Barbier"],["Mécanicien","Garagiste"],["Pilote","Steward"],["Conducteur","Chauffeur"],
    ["Journaliste","Reporter"],["Photographe","Vidéaste"],["Développeur","Designer"],["Architecte","Ingénieur"],["Électricien","Plombier"],["Facteur","Livreur"]
  ]},
  { theme: "Services et commerces", pairs: [
    ["Hôpital","Pharmacie"],["Banque","Assurance"],["Magasin","Supermarché"],["Restaurant","Fast-food"],["Boulangerie","Pâtisserie"],["Coiffeur","Barbier"],
    ["Cinéma","Bowling"],["Salle de sport","Piscine"],["Station-service","Garage"],["Poste","Banque"],["Hôtel","Airbnb"],["Marché","Centre commercial"],
    ["Bibliothèque","Librairie"],["Fleuriste","Jardinerie"],["Animalerie","Zoo"],["Opticien","Pharmacie"]
  ]},
  { theme: "Santé et corps", pairs: [
    ["Main","Pied"],["Bras","Jambe"],["Œil","Oreille"],["Nez","Bouche"],["Dent","Langue"],["Cœur","Poumon"],
    ["Genou","Coude"],["Doigt","Orteil"],["Cheveux","Barbe"],["Fièvre","Rhume"],["Toux","Éternuement"],["Pansement","Bandage"],
    ["Médicament","Sirop"],["Radio","Scanner"],["Urgences","Consultation"],["Sommeil","Repos"]
  ]},
  { theme: "Nature et météo", pairs: [
    ["Soleil","Lune"],["Étoile","Planète"],["Pluie","Neige"],["Orage","Tempête"],["Brouillard","Nuage"],["Vent","Tornade"],
    ["Rivière","Fleuve"],["Cascade","Fontaine"],["Volcan","Montagne"],["Grotte","Tunnel"],["Arbre","Buisson"],["Fleur","Plante"],
    ["Rose","Tulipe"],["Herbe","Mousse"],["Sable","Terre"],["Pierre","Rocher"]
  ]},
  { theme: "Espace et science", pairs: [
    ["Étoile","Planète"],["Mars","Vénus"],["Terre","Lune"],["Soleil","Étoile"],["Galaxie","Univers"],["Astéroïde","Comète"],
    ["Fusée","Satellite"],["Astronaute","Pilote"],["Télescope","Microscope"],["Atome","Molécule"],["Laser","Rayon X"],["Robot","Drone"]
  ]},
  { theme: "Fêtes et moments", pairs: [
    ["Anniversaire","Noël"],["Halloween","Carnaval"],["Pâques","Noël"],["Nouvel An","Anniversaire"],["Cadeau","Surprise"],["Bougie","Ballon"],
    ["Vacances","Week-end"],["Mariage","Anniversaire"],["Soirée","Festival"],["Pique-nique","Barbecue"],["Petit-déjeuner","Goûter"],["Déjeuner","Dîner"]
  ]},
  { theme: "Objets du quotidien", pairs: [
    ["Clé","Badge"],["Portefeuille","Porte-monnaie"],["Bouteille","Gourde"],["Parapluie","Imperméable"],["Brosse","Peigne"],["Savon","Shampoing"],
    ["Dentifrice","Bain de bouche"],["Serviette","Mouchoir"],["Ciseaux","Cutter"],["Scotch","Colle"],["Marteau","Tournevis"],["Vis","Clou"],
    ["Cadenas","Serrure"],["Pile","Batterie"],["Horloge","Montre"],["Calendrier","Agenda"]
  ]},
  { theme: "Émotions et idées", pairs: [
    ["Rire","Sourire"],["Peur","Stress"],["Joie","Excitation"],["Tristesse","Déception"],["Colère","Nervosité"],["Honte","Gêne"],
    ["Courage","Confiance"],["Chance","Hasard"],["Secret","Mystère"],["Rêve","Souvenir"],["Amour","Amitié"],["Blague","Ironie"],
    ["Rapide","Pressé"],["Géant","Grand"],["Silence","Calme"],["Bruit","Vacarme"]
  ]},
  { theme: "Marques et magasins", pairs: [
    ["Nike","Adidas"],["Puma","Adidas"],["Apple","Samsung"],["Google","Microsoft"],["PlayStation","Xbox"],["McDonald's","Burger King"],
    ["KFC","Popeyes"],["Starbucks","Costa Coffee"],["Carrefour","Auchan"],["Lidl","Aldi"],["Zara","H&M"],["Uniqlo","Zara"],
    ["IKEA","Conforama"],["Amazon","Cdiscount"],["Vinted","Leboncoin"],["Lego","Playmobil"]
  ]},
  { theme: "Jeux et loisirs", pairs: [
    ["Échecs","Dames"],["Uno","Skip-Bo"],["Monopoly","Cluedo"],["Poker","Blackjack"],["Billard","Bowling"],["Fléchettes","Pétanque"],
    ["Puzzle","Lego"],["Rubik's Cube","Puzzle"],["Cache-cache","Chat perché"],["Laser game","Paintball"],["Karting","Auto-tamponneuse"],["Escape game","Chasse au trésor"],
    ["Parc d'attractions","Fête foraine"],["Montagnes russes","Grande roue"],["Toboggan","Balançoire"],["Trampoline","Structure gonflable"]
  ]}
];

export const WORD_PAIRS: WordPair[] = GROUPS.flatMap(({ theme, pairs }) =>
  pairs.map(([a, b]) => [a, b, theme] as WordPair)
);

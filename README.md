<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Weihnachtsgeschenk für Papa</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            text-align: center;
            margin-top: 50px;
            background: url('https://t3.ftcdn.net/jpg/09/80/46/20/360_F_980462029_B2LkjsouUCHerSNOgwssTA407p1Y8xQR.jpg') no-repeat center center fixed;
            background-size: cover;
            color: white;
        }
        h1 {
            font-size: 24px;
            color: whitesmoke;
        }
        p {
            font-size: 18px;
            color: whitesmoke; 
        }
        input, button {
            padding: 10px;
            margin: 10px;
            border: 1px solid #ccc;
            border-radius: 5px;
            transition: transform 0.3s ease;
        }
        input:focus, button:hover {
            transform: scale(1.1);
        }
        button {
            background-color: #007BFF;
            color: white;
            cursor: pointer;
        }
        button:hover {
            background-color: #0056b3;
        }
        #message {
            margin-top: 20px;
            font-size: 1.2em;
            color: cyan;
            animation: fadeIn 1s ease-in-out;
        }
        @keyframes fadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
        }
    </style>
</head>
<body>
    <h1>🎄 Frohe Weihnachten, Papa! 🎄</h1>
    <p>Wähle ein Datum und ein Ereignis, welches wir unternehmen wollen:</p>
    <label for="date">Datum:</label>
    <input type="date" id="date" title="Datum auswählne" placeholder="Datum auswählen">
    <label for="event">Ereignis:</label>
    <input type="text" id="event" title="Ereignis eingeben" placeholder="Ereignis eingeben...">
    <button onclick="planDate()">Planen</button>
    <p id="message" style="margin-top: 20px; font-weight: bold;"></p>

    <script>
        document.getElementById("date").addEventListener("keydown", function(event) {
            if (event.key === "Enter") {
                planDate();
            }
        });

/*        document.getElementById("event").addEventListener("keydown", function(event) {
            if (event.key === "Enter") {
                planDate();
            }
        }); */

        function planDate() {
            const dateInput = document.getElementById('date').value;
            const eventInput = document.getElementById('event').value;
            const message = document.getElementById('message');

            if (dateInput && eventInput) {
                const chosenDate = new Date(dateInput).toLocaleDateString('de-DE');
                message.innerText = `Super! Wir planen ${eventInput} am ${chosenDate}. Ich freue mich darauf! 😊`;
            } else {
                message.innerText = "Bitte wähle ein Datum und gib ein Ereignis ein, damit wir etwas planen können.";
            }
        }
    </script>
</body>
</html>

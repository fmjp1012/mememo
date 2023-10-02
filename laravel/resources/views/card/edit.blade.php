<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="X-UA-Compatible" content="ie=edge">
    <title>Document</title>
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans:wght@400;700&display=swap">
    @vite('resources/js/app.js')
</head>

<body>
    <div id="app">
        <card-edit-container :user="{{ json_encode($user) }}" :card="{{ json_encode($card) }}" />
    </div>
</body>

</html>
